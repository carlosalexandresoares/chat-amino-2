const express = require('express');
const { Prisma } = require('@prisma/client');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const { isSiteAdmin } = require('../middleware/siteAdmin');
const chat = require('../services/chatMessages');
const community = require('../services/community');

const router = express.Router();
router.use(auth);
const fail = (res, error) => {
  console.error('Erro em comunidades:', error);
  res.status(500).json({ message: 'Não foi possível concluir a operação.' });
};
const validId = value => typeof value === 'string' && /^[a-z0-9_-]{1,50}$/.test(value);
const bad = (res, message) => res.status(400).json({ message });

async function access(req, res, roomId, moderator = false) {
  if (!validId(roomId)) { res.status(404).json({ message: 'Comunidade não encontrada.' }); return false; }
  const role = await community.roomRole(req.userId, roomId);
  const admin = await isSiteAdmin(req.userId);
  if (!role && !admin) { res.status(403).json({ message: 'Entre na comunidade para continuar.' }); return false; }
  if (await prisma.communitySanction.findFirst({ where: { roomId, userId: req.userId,
    type: 'SUSPEND', revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })) {
    res.status(403).json({ message: 'Sua participação está suspensa temporariamente.' }); return false;
  }
  if (moderator && !community.canModerate(role, admin)) {
    res.status(403).json({ message: 'Apenas moderadores podem fazer isso.' }); return false;
  }
  return true;
}

router.get('/topics', (_req, res) => res.json({ topics: community.topics.map(([id, label]) => ({ id, label })) }));

router.get('/interests', async (req, res) => {
  try {
    const rows = await prisma.communityInterest.findMany({ where: { userId: req.userId }, select: { topic: true } });
    res.json({ topics: rows.map(row => row.topic) });
  } catch (error) { fail(res, error); }
});
router.put('/interests', async (req, res) => {
  const topics = req.body?.topics;
  if (!Array.isArray(topics) || topics.length > community.topics.length ||
    topics.some(topic => !community.topicCodes.has(topic)) || new Set(topics).size !== topics.length)
    return bad(res, 'Escolha categorias válidas.');
  try {
    await prisma.$transaction(async tx => {
      await tx.communityInterest.deleteMany({ where: { userId: req.userId } });
      if (topics.length) await tx.communityInterest.createMany({ data: topics.map(topic => ({ userId: req.userId, topic })) });
    });
    res.json({ topics });
  } catch (error) { fail(res, error); }
});

router.get('/discover', async (req, res) => {
  const sort = String(req.query.sort || 'popular');
  const topic = String(req.query.topic || '');
  const page = Number(req.query.page || 1);
  const search = String(req.query.search || '').trim().slice(0, 80).replace(/[%_\\]/g, '');
  const favoritesOnly = req.query.favorites === 'true';
  if (!['popular', 'recent', 'growing', 'activity', 'forYou'].includes(sort) ||
    (topic && !community.topicCodes.has(topic)) || !Number.isInteger(page) || page < 1 || page > 40)
    return bad(res, 'Filtro de descoberta inválido.');
  const order = { popular: 'members DESC, r."createdAt" DESC', recent: 'r."createdAt" DESC',
    growing: 'growth DESC, r."createdAt" DESC', activity: 'activity DESC, r."createdAt" DESC',
    forYou: '"interestMatch" DESC, members DESC, r."createdAt" DESC' }[sort];
  try {
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT r.id, r.name, r.description, r.category, r.topic, r.banner, r."createdAt",
        m.members, m.growth, a.activity,
        EXISTS (SELECT 1 FROM "CommunityInterest" i WHERE i."userId" = ${req.userId} AND i.topic = r.topic) AS "interestMatch",
        EXISTS (SELECT 1 FROM "RoomFavorite" f WHERE f."roomId" = r.id AND f."userId" = ${req.userId}) AS "isFavorite",
        EXISTS (SELECT 1 FROM "RoomMember" own WHERE own."roomId" = r.id AND own."userId" = ${req.userId}) AS "isMember"
      FROM "Room" r
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS members,
          COUNT(*) FILTER (WHERE "joinedAt" >= NOW() - INTERVAL '7 days')::int AS growth
        FROM "RoomMember" WHERE "roomId" = r.id
      ) m
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS activity FROM "Message"
        WHERE "roomId" = r.id AND "createdAt" >= NOW() - INTERVAL '7 days' AND "deletedAt" IS NULL
      ) a
      WHERE (r."ownerId" IS NOT NULL OR r.id = 'geral')
        ${topic ? Prisma.sql`AND r.topic = ${topic}` : Prisma.empty}
        ${search ? Prisma.sql`AND (r.name ILIKE ${`%${search}%`} OR r.description ILIKE ${`%${search}%`})` : Prisma.empty}
        ${favoritesOnly ? Prisma.sql`AND EXISTS (SELECT 1 FROM "RoomFavorite" f WHERE f."roomId" = r.id AND f."userId" = ${req.userId})` : Prisma.empty}
      ORDER BY ${Prisma.raw(order)}, r.id DESC LIMIT 25 OFFSET ${(page - 1) * 24}
    `);
    const io = req.app.get('io');
    const rooms = rows.slice(0, 24).map(row => {
      const online = new Set();
      for (const socketId of io.sockets.adapter.rooms.get(row.id) || []) {
        const user = io.sockets.sockets.get(socketId)?.user;
        if (user && user.presenceStatus !== 'INVISIBLE') online.add(user.id);
      }
      return { ...row, onlineCount: online.size };
    });
    const hasMore = rows.length > 24 && page < 40;
    res.json({ rooms, hasMore, nextPage: hasMore ? page + 1 : null });
  } catch (error) { fail(res, error); }
});

router.put('/rooms/:roomId/favorite', async (req, res) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.roomId }, select: { id: true, ownerId: true } });
    if (!room || (room.id !== 'geral' && !room.ownerId)) return res.sendStatus(404);
    await prisma.roomFavorite.upsert({ where: { userId_roomId: { userId: req.userId, roomId: room.id } },
      create: { userId: req.userId, roomId: room.id }, update: {} });
    res.json({ favorite: true });
  } catch (error) { fail(res, error); }
});
router.delete('/rooms/:roomId/favorite', async (req, res) => {
  try {
    await prisma.roomFavorite.deleteMany({ where: { userId: req.userId, roomId: req.params.roomId } });
    res.json({ favorite: false });
  } catch (error) { fail(res, error); }
});

router.get('/rooms/:roomId/pins', async (req, res) => {
  try {
    if (!await access(req, res, req.params.roomId)) return;
    const pins = await prisma.pinnedMessage.findMany({ where: { roomId: req.params.roomId, message: { deletedAt: null } },
      orderBy: { pinnedAt: 'desc' }, take: 10,
      select: { messageId: true, pinnedAt: true, message: { select: chat.messageSelect },
        pinnedBy: { select: { id: true, username: true } } } });
    res.json({ pins: pins.map(pin => ({ messageId: pin.messageId, pinnedAt: pin.pinnedAt,
      pinnedBy: pin.pinnedBy, message: chat.format(pin.message) })) });
  } catch (error) { fail(res, error); }
});
router.put('/rooms/:roomId/pins/:messageId', async (req, res) => {
  try {
    if (!await access(req, res, req.params.roomId, true)) return;
    const roomId = req.params.roomId;
    const message = await prisma.message.findUnique({ where: { id: req.params.messageId }, select: { roomId: true, deletedAt: true } });
    if (!message || message.roomId !== roomId || message.deletedAt) return res.sendStatus(404);
    const pinned = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
      const already = await tx.pinnedMessage.findUnique({ where: { messageId: req.params.messageId }, select: { messageId: true } });
      if (!already && await tx.pinnedMessage.count({ where: { roomId } }) >= 10) return false;
      await tx.pinnedMessage.upsert({ where: { messageId: req.params.messageId },
        create: { messageId: req.params.messageId, roomId, pinnedById: req.userId }, update: {} });
      return true;
    });
    if (!pinned) return bad(res, 'A sala já tem 10 mensagens fixadas.');
    req.app.get('io').to(roomId).emit('room-pins-updated', { roomId });
    res.json({ pinned: true });
  } catch (error) { fail(res, error); }
});
router.delete('/rooms/:roomId/pins/:messageId', async (req, res) => {
  try {
    if (!await access(req, res, req.params.roomId, true)) return;
    const result = await prisma.pinnedMessage.deleteMany({ where: { messageId: req.params.messageId, roomId: req.params.roomId } });
    if (!result.count) return res.sendStatus(404);
    req.app.get('io').to(req.params.roomId).emit('room-pins-updated', { roomId: req.params.roomId });
    res.json({ pinned: false });
  } catch (error) { fail(res, error); }
});

router.get('/rooms/:roomId/search', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    if (!await access(req, res, roomId)) return;
    const search = String(req.query.q || '').trim().slice(0, 100);
    const authorId = String(req.query.authorId || '');
    const author = String(req.query.author || '').trim().slice(0, 50);
    const type = String(req.query.type || '');
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((!search || search.length < 2) && !authorId && !author && !type && !from && !to) return bad(res, 'Informe uma palavra ou filtro.');
    if ((from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf())) ||
      (from && to && from > to) || (type && !['TEXT', 'AUDIO', 'STICKER'].includes(type)) ||
      (authorId && !/^[a-z0-9]{10,40}$/.test(authorId))) return bad(res, 'Busca inválida.');
    const cursorId = req.query.cursor ? String(req.query.cursor) : null;
    const cursor = cursorId ? await prisma.message.findFirst({ where: { id: cursorId, roomId }, select: { createdAt: true, id: true } }) : null;
    if (cursorId && !cursor) return bad(res, 'Marcador inválido.');
    const rows = await prisma.message.findMany({ where: { roomId, deletedAt: null,
      ...(search ? { content: { contains: search, mode: 'insensitive' } } : {}),
      ...(authorId ? { userId: authorId } : {}), ...(type ? { type } : {}),
      ...(author ? { user: { username: { contains: author, mode: 'insensitive' } } } : {}),
      ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31, select: chat.messageSelect });
    res.json({ messages: rows.slice(0, 30).map(chat.format),
      nextCursor: rows.length > 30 ? rows[29].id : null });
  } catch (error) { fail(res, error); }
});

async function pollView(polls, userId) {
  if (!polls.length) return [];
  const votes = await prisma.pollVote.findMany({ where: { userId, pollId: { in: polls.map(poll => poll.id) } },
    select: { pollId: true, optionId: true } });
  const chosen = new Map();
  for (const vote of votes) {
    if (!chosen.has(vote.pollId)) chosen.set(vote.pollId, []);
    chosen.get(vote.pollId).push(vote.optionId);
  }
  return polls.map(poll => ({ id: poll.id, roomId: poll.roomId, question: poll.question,
    creator: poll.creator, createdAt: poll.createdAt, closesAt: poll.closesAt,
    allowMultiple: poll.allowMultiple, allowChange: poll.allowChange,
    options: poll.options.map(option => ({ id: option.id, label: option.label, votes: option._count.votes })),
    selectedOptionIds: chosen.get(poll.id) || [] }));
}
const pollSelect = { id: true, roomId: true, question: true, createdAt: true, closesAt: true,
  allowMultiple: true, allowChange: true, creator: { select: { id: true, username: true } },
  options: { orderBy: { position: 'asc' }, select: { id: true, label: true, _count: { select: { votes: true } } } } };

router.get('/rooms/:roomId/polls', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    if (!await access(req, res, roomId)) return;
    const cursorId = req.query.cursor ? String(req.query.cursor) : null;
    const cursor = cursorId ? await prisma.poll.findFirst({ where: { id: cursorId, roomId }, select: { createdAt: true, id: true } }) : null;
    if (cursorId && !cursor) return bad(res, 'Marcador inválido.');
    const rows = await prisma.poll.findMany({ where: { roomId, ...(cursor ? { OR: [
      { createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21, select: pollSelect });
    res.json({ polls: await pollView(rows.slice(0, 20), req.userId), nextCursor: rows.length > 20 ? rows[19].id : null });
  } catch (error) { fail(res, error); }
});

router.post('/rooms/:roomId/polls', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    if (!await access(req, res, roomId)) return;
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const options = Array.isArray(req.body?.options) ? req.body.options.map(x => typeof x === 'string' ? x.trim() : '') : [];
    const closesAt = new Date(req.body?.closesAt);
    const allowMultiple = req.body?.allowMultiple === true;
    const allowChange = req.body?.allowChange !== false;
    if (question.length < 5 || question.length > 240 || options.length < 2 || options.length > 6 ||
      options.some(x => x.length < 1 || x.length > 120) ||
      new Set(options.map(x => x.toLocaleLowerCase())).size !== options.length ||
      Number.isNaN(closesAt.valueOf()) || closesAt.getTime() < Date.now() + 60000 ||
      closesAt.getTime() > Date.now() + 30 * 86400000 ||
      (req.body?.allowMultiple !== undefined && typeof req.body.allowMultiple !== 'boolean') ||
      (req.body?.allowChange !== undefined && typeof req.body.allowChange !== 'boolean')) return bad(res, 'Confira pergunta, opções e prazo da enquete.');
    const poll = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
      if (await tx.poll.count({ where: { roomId, creatorId: req.userId,
        createdAt: { gte: new Date(Date.now() - 86400000) } } }) >= 5) return null;
      return tx.poll.create({ data: { roomId, creatorId: req.userId, question, closesAt,
        allowMultiple, allowChange, options: { create: options.map((label, position) => ({ label, position })) } }, select: { id: true } });
    });
    if (!poll) return res.status(429).json({ message: 'Limite de cinco enquetes por dia nesta comunidade.' });
    req.app.get('io').to(roomId).emit('room-polls-updated', { roomId, pollId: poll.id });
    res.status(201).json({ pollId: poll.id });
  } catch (error) { fail(res, error); }
});

router.put('/polls/:id/vote', async (req, res) => {
  const optionIds = req.body?.optionIds;
  if (!Array.isArray(optionIds) || optionIds.length < 1 || optionIds.length > 6 ||
    optionIds.some(id => typeof id !== 'string') || new Set(optionIds).size !== optionIds.length)
    return bad(res, 'Escolha as opções da enquete.');
  try {
    const poll = await prisma.poll.findUnique({ where: { id: req.params.id },
      select: { id: true, roomId: true, closesAt: true, allowMultiple: true, allowChange: true,
        options: { select: { id: true } } } });
    if (!poll) return res.sendStatus(404);
    if (!await access(req, res, poll.roomId)) return;
    if (poll.closesAt <= new Date()) return bad(res, 'Esta enquete terminou.');
    if ((!poll.allowMultiple && optionIds.length !== 1) ||
      optionIds.some(id => !poll.options.some(option => option.id === id))) return bad(res, 'Opção inválida.');
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Poll" WHERE id = ${poll.id} FOR UPDATE`;
      const stillOpen = await tx.poll.findUnique({ where: { id: poll.id }, select: { closesAt: true } });
      if (!stillOpen || stillOpen.closesAt <= new Date()) return 'closed';
      const prior = await tx.pollVote.findMany({ where: { pollId: poll.id, userId: req.userId }, select: { optionId: true } });
      if (prior.length && !poll.allowChange) return 'locked';
      if (prior.length === optionIds.length && prior.every(vote => optionIds.includes(vote.optionId))) return 'same';
      await tx.pollVote.deleteMany({ where: { pollId: poll.id, userId: req.userId } });
      await tx.pollVote.createMany({ data: optionIds.map(optionId => ({ pollId: poll.id, optionId, userId: req.userId })) });
      return 'saved';
    });
    if (result === 'closed') return bad(res, 'Esta enquete terminou.');
    if (result === 'locked') return bad(res, 'Esta enquete não permite alterar o voto.');
    if (result === 'saved') req.app.get('io').to(poll.roomId).emit('room-polls-updated', { roomId: poll.roomId, pollId: poll.id });
    res.json({ voted: true });
  } catch (error) { fail(res, error); }
});

router.delete('/polls/:id', async (req, res) => {
  try {
    const poll = await prisma.poll.findUnique({ where: { id: req.params.id }, select: { roomId: true, creatorId: true } });
    if (!poll) return res.sendStatus(404);
    if (!await access(req, res, poll.roomId)) return;
    const role = await community.roomRole(req.userId, poll.roomId);
    if (poll.creatorId !== req.userId && !community.canModerate(role, await isSiteAdmin(req.userId))) return res.sendStatus(403);
    await prisma.poll.delete({ where: { id: req.params.id } });
    req.app.get('io').to(poll.roomId).emit('room-polls-updated', { roomId: poll.roomId, pollId: req.params.id });
    res.json({ deleted: true });
  } catch (error) { fail(res, error); }
});

module.exports = router;
