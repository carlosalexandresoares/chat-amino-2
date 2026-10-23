const express = require('express');
const multer = require('multer');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const media = require('../services/chatMedia');
const direct = require('../services/direct');
const notifications = require('../services/notifications');
const moderation = require('../services/moderation');

const router = express.Router();
router.use(auth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: media.MAX_AUDIO_BYTES, files: 1 } }).single('file');
const fail = (res, error) => { if (!error.status) console.error('Erro em conversa privada:', error);
  res.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível concluir a operação.' }); };
const problem = (message, status = 400) => media.problem(message, status);
const userRoom = id => `user:${id}`;
const notify = (req, conversation, event, payload) => {
  const io = req.app.get('io');
  io.to(userRoom(conversation.userAId)).to(userRoom(conversation.userBId)).emit(event, payload);
};
const allowed = async (req, res) => {
  const conversation = await direct.access(req.userId, req.params.id);
  if (!conversation) res.status(404).json({ message: 'Conversa indisponível.' });
  return conversation;
};

router.get('/settings', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId },
      select: { directPrivacy: true, presenceStatus: true, statusText: true } });
    res.json({ settings: user });
  } catch (error) { fail(res, error); }
});
router.patch('/settings', async (req, res) => {
  try {
    const { directPrivacy, presenceStatus, statusText } = req.body || {};
    if (directPrivacy !== undefined && !['EVERYONE', 'FOLLOWERS', 'FOLLOWING', 'NOBODY'].includes(directPrivacy)) throw problem('Preferência de mensagens inválida.');
    if (presenceStatus !== undefined && !['ONLINE', 'AWAY', 'BUSY', 'INVISIBLE'].includes(presenceStatus)) throw problem('Status inválido.');
    if (statusText !== undefined && (typeof statusText !== 'string' || statusText.length > 100)) throw problem('Mensagem de status inválida.');
    const settings = await prisma.user.update({ where: { id: req.userId }, data: {
      ...(directPrivacy !== undefined ? { directPrivacy } : {}),
      ...(presenceStatus !== undefined ? { presenceStatus } : {}),
      ...(statusText !== undefined ? { statusText: statusText.trim() || null } : {}),
    }, select: { directPrivacy: true, presenceStatus: true, statusText: true } });
    const io = req.app.get('io');
    for (const socket of io.sockets.sockets.values()) if (socket.user?.id === req.userId) socket.user.presenceStatus = settings.presenceStatus;
    if (settings.presenceStatus === 'INVISIBLE') req.app.get('removeInvisibleVoiceUser')?.(req.userId);
    req.app.get('refreshPresence')?.(req.userId);
    res.json({ settings });
  } catch (error) { fail(res, error); }
});

router.get('/blocks', async (req, res) => {
  try {
    const blocks = await prisma.userBlock.findMany({ where: { blockerId: req.userId }, take: 100,
      orderBy: { createdAt: 'desc' }, select: { blocked: { select: { id: true, username: true, avatar: true } } } });
    res.json({ users: blocks.map(item => item.blocked) });
  } catch (error) { fail(res, error); }
});
router.put('/blocks/:userId', async (req, res) => {
  try {
    if (req.params.userId === req.userId) throw problem('Você não pode bloquear a si mesmo.');
    if (!await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true } })) throw problem('Usuário não encontrado.', 404);
    await prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: req.userId, blockedId: req.params.userId } },
      create: { blockerId: req.userId, blockedId: req.params.userId }, update: {} });
    await prisma.follow.deleteMany({ where: { OR: [
      { followerId: req.userId, followedId: req.params.userId }, { followerId: req.params.userId, followedId: req.userId },
    ] } });
    await prisma.directConversation.updateMany({ where: { status: 'PENDING', OR: [
      { userAId: req.userId, userBId: req.params.userId }, { userBId: req.userId, userAId: req.params.userId },
    ] }, data: { status: 'DECLINED' } });
    req.app.get('io').to(userRoom(req.userId)).to(userRoom(req.params.userId)).emit('direct-updated');
    res.json({ blocked: true });
  } catch (error) { fail(res, error); }
});
router.delete('/blocks/:userId', async (req, res) => {
  try {
    await prisma.userBlock.deleteMany({ where: { blockerId: req.userId, blockedId: req.params.userId } });
    res.json({ blocked: false });
  } catch (error) { fail(res, error); }
});

router.post('/conversations', async (req, res) => {
  try {
    const recipientId = req.body?.userId;
    if (typeof recipientId !== 'string' || !recipientId || recipientId === req.userId) throw problem('Destinatário inválido.');
    if (await direct.blocked(req.userId, recipientId)) throw problem('Conversa indisponível.', 403);
    const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true, directPrivacy: true } });
    if (!recipient) throw problem('Usuário não encontrado.', 404);
    const [userAId, userBId] = direct.pair(req.userId, recipientId);
    const existing = await prisma.directConversation.findUnique({ where: { userAId_userBId: { userAId, userBId } },
      select: { id: true, status: true, requesterId: true } });
    if (existing?.status !== 'DECLINED' && existing) return res.json({ conversation: existing });
    if (existing?.status === 'DECLINED' && existing.requesterId === req.userId) throw problem('Esta solicitação foi recusada.', 403);
    if (!await direct.canRequest(req.userId, recipient)) throw problem('Este usuário não recebe solicitações suas.', 403);
    if (existing?.status === 'DECLINED') {
      const reopened = await prisma.directConversation.updateMany({ where: { id: existing.id, status: 'DECLINED' },
        data: { requesterId: req.userId, status: 'ACTIVE' } });
      if (!reopened.count) throw problem('Conversa alterada. Tente novamente.', 409);
      notify(req, { userAId, userBId }, 'direct-updated');
      return res.json({ conversation: { id: existing.id, status: 'ACTIVE' } });
    }
    const known = await prisma.follow.findUnique({ where: { followerId_followedId: { followerId: recipientId, followedId: req.userId } }, select: { followerId: true } });
    const status = known ? 'ACTIVE' : 'PENDING';
    let conversation;
    try {
      conversation = await prisma.directConversation.create({ data: { userAId, userBId, requesterId: req.userId, status },
        select: { id: true, status: true } });
    } catch (error) {
      if (error.code !== 'P2002') throw error;
      conversation = await prisma.directConversation.findUnique({ where: { userAId_userBId: { userAId, userBId } },
        select: { id: true, status: true } });
      if (!conversation || conversation.status === 'DECLINED') throw problem('Esta solicitação foi recusada.', 403);
    }
    notify(req, { userAId, userBId }, 'direct-updated');
    res.status(201).json({ conversation });
  } catch (error) { fail(res, error); }
});

router.get('/conversations', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().slice(0, 80);
    const archived = req.query.archived === 'true';
    const page = Math.max(1, Math.min(20, Number.parseInt(req.query.page, 10) || 1));
    const deliveryWhere = {
      senderId: { not: req.userId }, deliveredAt: null,
      conversation: { OR: [{ userAId: req.userId }, { userBId: req.userId }] },
    };
    const pendingDeliveries = await prisma.directMessage.findMany({ where: deliveryWhere, take: 100,
      select: { id: true, senderId: true, conversationId: true } });
    if (pendingDeliveries.length) {
      await prisma.directMessage.updateMany({ where: { id: { in: pendingDeliveries.map(item => item.id) }, deliveredAt: null }, data: { deliveredAt: new Date() } });
      for (const senderId of new Set(pendingDeliveries.map(item => item.senderId))) {
        req.app.get('io').to(userRoom(senderId)).emit('direct-delivered');
      }
    }
    const rows = await prisma.directConversation.findMany({ where: {
      AND: [
        { OR: [{ userAId: req.userId }, { userBId: req.userId }] },
        ...(search ? [{ OR: [
        { userAId: req.userId, userB: { username: { contains: search, mode: 'insensitive' } } },
        { userBId: req.userId, userA: { username: { contains: search, mode: 'insensitive' } } },
      ] }] : []),
      ], status: { not: 'DECLINED' },
      settings: archived ? { some: { userId: req.userId, archived: true } } : { none: { userId: req.userId, archived: true } },
    }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 51, select: {
      id: true, status: true, requesterId: true, userAId: true, userBId: true, updatedAt: true,
      userA: { select: { id: true, username: true, avatar: true, presenceStatus: true, statusText: true } },
      userB: { select: { id: true, username: true, avatar: true, presenceStatus: true, statusText: true } },
      settings: { where: { userId: req.userId }, select: { muted: true, pinned: true, archived: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, type: true, content: true, createdAt: true, deletedAt: true } },
    } });
    const ids = rows.slice(0, 50).map(item => item.id);
    const unread = ids.length ? await prisma.directMessage.groupBy({ by: ['conversationId'], where: {
      conversationId: { in: ids }, senderId: { not: req.userId }, readAt: null, deletedAt: null,
    }, _count: { _all: true } }) : [];
    const unreadMap = new Map(unread.map(item => [item.conversationId, item._count._all]));
    const conversations = rows.slice(0, 50).map(item => ({
      id: item.id, status: item.status, incomingRequest: item.status === 'PENDING' && item.requesterId !== req.userId,
      outgoingRequest: item.status === 'PENDING' && item.requesterId === req.userId,
      other: (() => { const other = item.userAId === req.userId ? item.userB : item.userA;
        return other.presenceStatus === 'INVISIBLE' ? { ...other, presenceStatus: null, statusText: null } : other; })(),
      settings: item.settings[0] || { muted: false, pinned: false, archived: false },
      lastMessage: item.messages[0] || null, unreadCount: unreadMap.get(item.id) || 0, updatedAt: item.updatedAt,
    }));
    conversations.sort((a, b) => Number(b.settings.pinned) - Number(a.settings.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ conversations, hasMore: rows.length > 50, nextPage: page + 1 });
  } catch (error) { fail(res, error); }
});

router.get('/conversations/:id', async (req, res) => {
  try {
    const conversation = await allowed(req, res); if (!conversation) return;
    const otherId = direct.otherId(conversation, req.userId);
    const [other, settings] = await Promise.all([
      prisma.user.findUnique({ where: { id: otherId }, select: {
        id: true, username: true, avatar: true, presenceStatus: true, statusText: true,
      } }),
      prisma.directSettings.findUnique({ where: { conversationId_userId: { conversationId: conversation.id, userId: req.userId } },
        select: { muted: true, pinned: true, archived: true } }),
    ]);
    if (!other) return res.sendStatus(404);
    res.json({ conversation: { ...conversation,
      incomingRequest: conversation.status === 'PENDING' && conversation.requesterId !== req.userId,
      outgoingRequest: conversation.status === 'PENDING' && conversation.requesterId === req.userId,
      other: other.presenceStatus === 'INVISIBLE' ? { ...other, presenceStatus: null, statusText: null } : other,
      settings: settings || { muted: false, pinned: false, archived: false },
    } });
  } catch (error) { fail(res, error); }
});

router.patch('/conversations/:id/request', async (req, res) => {
  try {
    const conversation = await allowed(req, res); if (!conversation) return;
    if (conversation.status !== 'PENDING' || conversation.requesterId === req.userId) throw problem('Solicitação indisponível.', 403);
    if (!['accept', 'decline'].includes(req.body?.action)) throw problem('Ação inválida.');
    if (await direct.blocked(conversation.userAId, conversation.userBId)) throw problem('Conversa bloqueada.', 403);
    const result = await prisma.directConversation.updateMany({ where: { id: conversation.id, status: 'PENDING' },
      data: { status: req.body.action === 'accept' ? 'ACTIVE' : 'DECLINED' } });
    if (!result.count) throw problem('Solicitação já respondida.', 409);
    notify(req, conversation, 'direct-updated');
    res.json({ status: req.body.action === 'accept' ? 'ACTIVE' : 'DECLINED' });
  } catch (error) { fail(res, error); }
});

router.post('/conversations/:id/report', async (req, res) => {
  try {
    const conversation = await allowed(req, res); if (!conversation) return;
    const reason = req.body?.reason;
    const details = typeof req.body?.details === 'string' ? req.body.details.trim() : '';
    await moderation.submitReport({ reporterId: req.userId, kind: 'DIRECT', targetId: conversation.id,
      reason, details });
    res.status(201).json({ reported: true });
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/conversations/:id/settings', async (req, res) => {
  try {
    const conversation = await allowed(req, res); if (!conversation) return;
    const fields = ['muted', 'pinned', 'archived'];
    const data = Object.fromEntries(fields.filter(key => req.body?.[key] !== undefined).map(key => [key, req.body[key]]));
    if (!Object.keys(data).length || Object.values(data).some(value => typeof value !== 'boolean')) throw problem('Preferências inválidas.');
    const settings = await prisma.directSettings.upsert({ where: { conversationId_userId: { conversationId: conversation.id, userId: req.userId } },
      create: { conversationId: conversation.id, userId: req.userId, ...data }, update: data });
    res.json({ settings });
  } catch (error) { fail(res, error); }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const conversation = await allowed(req, res); if (!conversation) return;
    const beforeId = req.query.before;
    const before = beforeId ? await prisma.directMessage.findFirst({ where: { id: String(beforeId), conversationId: conversation.id },
      select: { id: true, createdAt: true } }) : null;
    if (beforeId && !before) throw problem('Marcador inválido.');
    const search = String(req.query.search || '').trim().slice(0, 100);
    const author = String(req.query.author || '');
    const type = String(req.query.type || '');
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((author && !['me', 'other'].includes(author)) ||
      (type && !['TEXT', 'AUDIO', 'STICKER', 'IMAGE'].includes(type)) ||
      (from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf())) ||
      (from && to && from > to)) throw problem('Filtros de busca inválidos.');
    const rows = await prisma.directMessage.findMany({ where: { conversationId: conversation.id,
      ...(before ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] } : {}),
      ...(search ? { content: { contains: search, mode: 'insensitive' }, deletedAt: null } : {}),
      ...(author ? { senderId: author === 'me' ? req.userId : direct.otherId(conversation, req.userId) } : {}),
      ...(type ? { type } : {}),
      ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 41, select: direct.messageSelect });
    const now = new Date();
    const unread = await prisma.directMessage.updateMany({ where: { conversationId: conversation.id,
      senderId: { not: req.userId }, readAt: null }, data: { readAt: now, deliveredAt: now } });
    if (unread.count) {
      notify(req, conversation, 'direct-read', { conversationId: conversation.id, readAt: now });
    }
    res.json({ messages: rows.slice(0, 40).reverse().map(direct.publicMessage), hasMore: rows.length > 40 });
  } catch (error) { fail(res, error); }
});

router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const conversation = await allowed(req, res); if (!conversation) return;
    if (conversation.status !== 'ACTIVE' && !(conversation.status === 'PENDING' && conversation.requesterId === req.userId)) throw problem('Solicitação ainda não aceita.', 403);
    if (await direct.blocked(conversation.userAId, conversation.userBId)) throw problem('Conversa bloqueada.', 403);
    const recipient = await prisma.user.findUnique({ where: { id: direct.otherId(conversation, req.userId) }, select: { id: true, directPrivacy: true } });
    if (!recipient || !await direct.canRequest(req.userId, recipient)) throw problem('Este usuário não recebe mensagens suas.', 403);
    const { type = 'TEXT', mediaId, replyToId } = req.body || {};
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!['TEXT', 'AUDIO', 'STICKER', 'IMAGE'].includes(type)) throw problem('Tipo inválido.');
    if ((type === 'TEXT' && (!content || content.length > 2000)) || (type !== 'TEXT' && content)) throw problem('Conteúdo inválido.');
    if (type !== 'TEXT' && (typeof mediaId !== 'string' || !mediaId)) throw problem('Anexo inválido.');
    if (replyToId && (typeof replyToId !== 'string' || replyToId.length > 100)) throw problem('Resposta inválida.');
    if (type !== 'TEXT') {
      const kind = { AUDIO: 'AUDIO', STICKER: 'STICKER', IMAGE: 'DIRECT_IMAGE' }[type];
      const asset = await prisma.chatAsset.findFirst({ where: { id: mediaId, kind, ownerId: req.userId,
        ...(type === 'STICKER' ? {} : { directMessages: { none: {} } }) }, select: { id: true } });
      if (!asset) throw problem('Anexo indisponível.', 403);
    }
    const recent = await prisma.directMessage.count({ where: { conversationId: conversation.id, senderId: req.userId,
      createdAt: { gte: new Date(Date.now() - 60000) } } });
    if (recent >= 20) throw problem('Aguarde antes de enviar mais mensagens.', 429);
    if (replyToId && !await prisma.directMessage.findFirst({ where: { id: replyToId, conversationId: conversation.id, deletedAt: null }, select: { id: true } })) throw problem('Resposta inválida.');
    const other = direct.otherId(conversation, req.userId);
    const online = req.app.get('io').sockets.adapter.rooms.get(userRoom(other))?.size > 0;
    const message = await prisma.$transaction(async tx => {
      const created = await tx.directMessage.create({ data: { conversationId: conversation.id, senderId: req.userId,
        type, content, mediaId: type === 'TEXT' ? null : mediaId, replyToId: replyToId || null,
        deliveredAt: online ? new Date() : null }, select: direct.messageSelect });
      await tx.directConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      return created;
    });
    notify(req, conversation, 'direct-message', direct.publicMessage(message));
    void (async () => {
      const muted = await prisma.directSettings.findUnique({ where: { conversationId_userId: { conversationId: conversation.id, userId: other } },
        select: { muted: true } });
      if (!muted?.muted) await notifications.publish({ recipientId: other, actorId: req.userId, kind: 'DIRECT_MESSAGE',
        sourceKey: `direct:${message.id}`, title: 'Nova mensagem privada',
        body: `${message.sender.username} enviou uma mensagem.`, href: `/direct.html?conversation=${conversation.id}&message=${message.id}`,
        io: req.app.get('io') });
    })().catch(error => console.error('Falha na notificação de DM:', error));
    res.status(201).json({ message: direct.publicMessage(message) });
  } catch (error) { fail(res, error); }
});

router.delete('/messages/:id', async (req, res) => {
  try {
    const message = await prisma.directMessage.findUnique({ where: { id: req.params.id }, select: { senderId: true, conversationId: true } });
    if (!message || message.senderId !== req.userId) throw problem('Mensagem indisponível.', 403);
    const conversation = await direct.access(req.userId, message.conversationId);
    if (!conversation) throw problem('Mensagem indisponível.', 403);
    await prisma.directMessage.update({ where: { id: req.params.id }, data: { deletedAt: new Date(), content: '', mediaId: null } });
    notify(req, conversation, 'direct-deleted', { id: req.params.id, conversationId: conversation.id });
    res.json({ deleted: true });
  } catch (error) { fail(res, error); }
});
router.put('/messages/:id/reaction', async (req, res) => {
  try {
    const message = await prisma.directMessage.findUnique({ where: { id: req.params.id }, select: { conversationId: true, deletedAt: true } });
    const conversation = message && await direct.access(req.userId, message.conversationId);
    if (!conversation || message.deletedAt) throw problem('Mensagem indisponível.', 403);
    if (await direct.blocked(conversation.userAId, conversation.userBId)) throw problem('Conversa bloqueada.', 403);
    const emoji = req.body?.emoji;
    if (emoji !== null && !['❤️', '😂', '👍', '😮', '😢', '🔥'].includes(emoji)) throw problem('Reação inválida.');
    if (emoji === null) await prisma.directReaction.deleteMany({ where: { messageId: req.params.id, userId: req.userId } });
    else await prisma.directReaction.upsert({ where: { messageId_userId: { messageId: req.params.id, userId: req.userId } },
      create: { messageId: req.params.id, userId: req.userId, emoji }, update: { emoji } });
    const reactions = await prisma.directReaction.findMany({ where: { messageId: req.params.id }, select: { userId: true, emoji: true } });
    notify(req, conversation, 'direct-reactions', { id: req.params.id, conversationId: conversation.id, reactions });
    res.json({ reactions });
  } catch (error) { fail(res, error); }
});

router.post('/conversations/:id/media', (req, res, next) => upload(req, res, error => error
  ? res.status(400).json({ message: 'Arquivo inválido ou grande demais.' }) : next()), async (req, res) => {
  let stored;
  try {
    const conversation = await allowed(req, res); if (!conversation) return;
    if (conversation.status !== 'ACTIVE' && !(conversation.status === 'PENDING' && conversation.requesterId === req.userId)) throw problem('Solicitação ainda não aceita.', 403);
    if (await direct.blocked(conversation.userAId, conversation.userBId)) throw problem('Conversa bloqueada.', 403);
    const recipient = await prisma.user.findUnique({ where: { id: direct.otherId(conversation, req.userId) }, select: { id: true, directPrivacy: true } });
    if (!recipient || !await direct.canRequest(req.userId, recipient)) throw problem('Este usuário não recebe mensagens suas.', 403);
    const type = req.body?.type;
    if (!['AUDIO', 'IMAGE'].includes(type)) throw problem('Tipo inválido.');
    const kind = type === 'AUDIO' ? 'AUDIO' : 'DIRECT_IMAGE';
    const count = await prisma.chatAsset.count({ where: { ownerId: req.userId, kind, createdAt: { gte: new Date(Date.now() - 3600000) } } });
    if (count >= 12) throw problem('Limite de uploads atingido.', 429);
    const prepared = type === 'AUDIO' ? await media.prepareAudio(req.file?.buffer) : await media.prepareImage(req.file?.buffer, 'DIRECT_IMAGE');
    stored = await media.put(kind, req.userId, null, prepared);
    const asset = await prisma.chatAsset.create({ data: stored, select: { id: true, duration: true } });
    res.status(201).json({ asset });
  } catch (error) { if (stored) await media.remove(stored.key).catch(console.error); fail(res, error); }
});
router.get('/media/:id', async (req, res) => {
  try {
    const asset = await prisma.chatAsset.findUnique({ where: { id: req.params.id }, select: {
      key: true, kind: true, mimeType: true,
    } });
    if (!asset) return res.sendStatus(404);
    const visible = await prisma.directMessage.findFirst({ where: { mediaId: req.params.id, deletedAt: null,
      conversation: { OR: [{ userAId: req.userId }, { userBId: req.userId }] } }, select: { id: true } });
    if (!visible) return res.sendStatus(403);
    const data = await media.get(asset.key);
    res.set({ 'Content-Type': asset.mimeType, 'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch (error) { fail(res, error); }
});

module.exports = router;
