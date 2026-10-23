const express = require('express');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const { isSiteAdmin } = require('../middleware/siteAdmin');
const community = require('../services/community');
const gamification = require('../services/gamification');
const moderation = require('../services/moderation');

const router = express.Router();
router.use(auth);
const types = new Set(['PROJECTION', 'ANIME', 'TOURNAMENT', 'QUIZ', 'MEETUP', 'CUSTOM']);
const idPattern = /^[a-z0-9_-]{1,50}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const bad = (res, message) => res.status(400).json({ message });
function fail(res, error) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error('Erro em eventos:', error);
  return res.status(500).json({ message: 'Não foi possível concluir a operação.' });
}
async function roleFor(userId, roomId) {
  if (!idPattern.test(roomId)) return null;
  const role = await community.roomRole(userId, roomId);
  return { role, admin: await isSiteAdmin(userId) };
}
async function roomAccess(req, res, roomId, manage = false) {
  const access = await roleFor(req.userId, roomId);
  if (!access || (!access.role && !access.admin)) {
    res.status(403).json({ message: 'Entre na comunidade para continuar.' }); return false;
  }
  if (await moderation.activeSanction(roomId, req.userId, ['SUSPEND'])) {
    res.status(403).json({ message: 'Sua participação está suspensa temporariamente.' }); return false;
  }
  if (manage && !community.canModerate(access.role, access.admin)) {
    res.status(403).json({ message: 'Apenas moderadores podem organizar eventos.' }); return false;
  }
  return true;
}
function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: value }); return true; }
  catch { return false; }
}
function eventInput(body, res, { reschedule = false } = {}) {
  const startsAt = typeof body?.startsAt === 'string' && isoDate.test(body.startsAt)
    ? new Date(body.startsAt) : new Date(NaN);
  if (Number.isNaN(startsAt.valueOf()) || startsAt.getTime() < Date.now() + 60000 ||
      startsAt.getTime() > Date.now() + 365 * 86400000 || !validTimeZone(body?.timeZone)) {
    bad(res, 'Escolha data futura e fuso horário válido.'); return null;
  }
  if (reschedule) return { startsAt, timeZone: body.timeZone };
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const coverUrl = typeof body?.coverUrl === 'string' ? body.coverUrl.trim() : '';
  const capacity = body?.capacity === null || body?.capacity === '' || body?.capacity === undefined
    ? null : Number(body.capacity);
  const organizerId = body?.organizerId === undefined ? null : body.organizerId;
  let coverValid = !coverUrl;
  if (coverUrl && coverUrl.length <= 1000) {
    try { const url = new URL(coverUrl); coverValid = url.protocol === 'https:' &&
      !url.username && !url.password && !url.port; } catch { coverValid = false; }
  }
  if (!types.has(body?.type) || title.length < 3 || title.length > 120 ||
      description.length > 2000 || !coverValid ||
      (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000)) ||
      (organizerId !== null && (typeof organizerId !== 'string' || !/^[a-z0-9]{10,40}$/.test(organizerId)))) {
    bad(res, 'Confira tipo, título, descrição, capa, organizador e capacidade.'); return null;
  }
  return { type: body.type, title, description, coverUrl: coverUrl || null,
    startsAt, timeZone: body.timeZone, capacity, organizerId };
}
const eventSelect = {
  id: true, roomId: true, type: true, status: true, title: true, description: true,
  coverUrl: true, startsAt: true, timeZone: true, capacity: true, registrationOpen: true,
  createdAt: true, updatedAt: true, organizerId: true, creatorId: true,
  room: { select: { name: true } },
  organizer: { select: { id: true, username: true, avatar: true } },
  _count: { select: { participants: true } },
};
async function decorate(events, userId) {
  if (!events.length) return [];
  const registrations = await prisma.eventParticipant.findMany({ where: {
    userId, eventId: { in: events.map(event => event.id) },
  }, select: { eventId: true, reminderEnabled: true, attendedAt: true } });
  const byId = new Map(registrations.map(item => [item.eventId, item]));
  return events.map(event => ({ ...event, participantCount: event._count.participants,
    _count: undefined, registered: byId.has(event.id),
    reminderEnabled: byId.get(event.id)?.reminderEnabled || false,
    attendedAt: byId.get(event.id)?.attendedAt || null }));
}
async function visibleEvent(req, res, id, manage = false) {
  const event = await prisma.communityEvent.findUnique({ where: { id }, select: { id: true,
    roomId: true, organizerId: true } });
  if (!event) { res.sendStatus(404); return null; }
  if (!await roomAccess(req, res, event.roomId, manage && event.organizerId !== req.userId)) return null;
  return event;
}
function changed(req, event) {
  req.app.get('io')?.to(event.roomId).emit('community-events-updated',
    { roomId: event.roomId, eventId: event.id });
}

router.get('/rooms/mine', async (req, res) => {
  try {
    const [memberships, admin] = await Promise.all([
      prisma.roomMember.findMany({ where: { userId: req.userId,
        room: { sanctions: { none: { userId: req.userId, type: 'SUSPEND',
          revokedAt: null, expiresAt: { gt: new Date() } } } } }, take: 100,
        select: { role: true, room: { select: { id: true, name: true } } } }),
      isSiteAdmin(req.userId),
    ]);
    res.json({ rooms: memberships.map(item => ({ ...item.room,
      canManage: community.canModerate(item.role, admin) })), admin });
  } catch (error) { fail(res, error); }
});

router.get('/', async (req, res) => {
  try {
    const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : null;
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 40) return bad(res, 'Página inválida.');
    let roomIds;
    if (roomId) {
      if (!await roomAccess(req, res, roomId)) return;
      roomIds = [roomId];
    } else if (!await isSiteAdmin(req.userId)) {
      const memberships = await prisma.roomMember.findMany({ where: { userId: req.userId,
        room: { sanctions: { none: { userId: req.userId, type: 'SUSPEND',
          revokedAt: null, expiresAt: { gt: new Date() } } } } },
        select: { roomId: true } });
      roomIds = [...new Set(['geral', ...memberships.map(item => item.roomId)])];
    }
    const rows = await prisma.communityEvent.findMany({ where: {
      status: 'SCHEDULED', startsAt: { gte: new Date(Date.now() - 2 * 3600000) },
      ...(roomIds ? { roomId: { in: roomIds } } : {}),
      room: { sanctions: { none: { userId: req.userId, type: 'SUSPEND',
        revokedAt: null, expiresAt: { gt: new Date() } } } },
    }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * 20,
    take: 21, select: eventSelect });
    res.json({ events: await decorate(rows.slice(0, 20), req.userId),
      hasMore: rows.length > 20 && page < 40 });
  } catch (error) { fail(res, error); }
});
router.get('/:id', async (req, res) => {
  try {
    if (!await visibleEvent(req, res, req.params.id)) return;
    const event = await prisma.communityEvent.findUnique({ where: { id: req.params.id },
      select: eventSelect });
    res.json({ event: (await decorate([event], req.userId))[0] });
  } catch (error) { fail(res, error); }
});
router.get('/:id/participants', async (req, res) => {
  try {
    if (!await visibleEvent(req, res, req.params.id)) return;
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 334) return bad(res, 'Página inválida.');
    const rows = await prisma.eventParticipant.findMany({ where: { eventId: req.params.id },
      orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }], skip: (page - 1) * 30, take: 31,
      select: { joinedAt: true, user: { select: { id: true, username: true, avatar: true } } } });
    res.json({ participants: rows.slice(0, 30), hasMore: rows.length > 30 && page < 334 });
  } catch (error) { fail(res, error); }
});
router.post('/', async (req, res) => {
  try {
    const roomId = req.body?.roomId;
    if (typeof roomId !== 'string' || !await roomAccess(req, res, roomId, true)) return;
    const input = eventInput(req.body, res);
    if (!input) return;
    const organizerId = input.organizerId || req.userId;
    if (organizerId !== req.userId && !await community.roomRole(organizerId, roomId))
      return bad(res, 'O organizador precisa participar da comunidade.');
    const event = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
      const count = await tx.communityEvent.count({ where: { roomId, creatorId: req.userId,
        createdAt: { gte: new Date(Date.now() - 86400000) } } });
      if (count >= 10) return null;
      return tx.communityEvent.create({ data: { roomId, creatorId: req.userId, organizerId,
        type: input.type, title: input.title, description: input.description,
        coverUrl: input.coverUrl, startsAt: input.startsAt, timeZone: input.timeZone,
        capacity: input.capacity }, select: { id: true, roomId: true } });
    }, { timeout: 15000 });
    if (!event) return res.status(429).json({ message: 'Limite de dez eventos por dia nesta comunidade.' });
    changed(req, event);
    res.status(201).json({ eventId: event.id });
  } catch (error) { fail(res, error); }
});
router.post('/:id/register', async (req, res) => {
  try {
    const event = await visibleEvent(req, res, req.params.id);
    if (!event) return;
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CommunityEvent" WHERE id = ${event.id} FOR UPDATE`;
      const current = await tx.communityEvent.findUnique({ where: { id: event.id },
        select: { startsAt: true, status: true, capacity: true, registrationOpen: true } });
      if (!current || current.status !== 'SCHEDULED' || current.startsAt <= new Date() ||
          !current.registrationOpen) return 'closed';
      if (await tx.eventParticipant.findUnique({ where: { eventId_userId: {
        eventId: event.id, userId: req.userId } } })) return 'registered';
      if (current.capacity !== null && await tx.eventParticipant.count({
        where: { eventId: event.id } }) >= current.capacity) return 'full';
      await tx.eventParticipant.create({ data: { eventId: event.id, userId: req.userId } });
      return 'ok';
    }, { timeout: 15000 });
    if (result === 'closed') return res.status(409).json({ message: 'Inscrições encerradas.' });
    if (result === 'full') return res.status(409).json({ message: 'Evento lotado.' });
    if (result === 'ok') changed(req, event);
    res.json({ registered: true });
  } catch (error) { fail(res, error); }
});
router.delete('/:id/register', async (req, res) => {
  try {
    const event = await visibleEvent(req, res, req.params.id);
    if (!event) return;
    const deleted = await prisma.eventParticipant.deleteMany({ where: {
      eventId: event.id, userId: req.userId, attendedAt: null } });
    if (!deleted.count && await prisma.eventParticipant.findUnique({ where: { eventId_userId: {
      eventId: event.id, userId: req.userId } } }))
      return res.status(409).json({ message: 'A presença já foi registrada neste evento.' });
    if (deleted.count) changed(req, event);
    res.json({ registered: false });
  } catch (error) { fail(res, error); }
});
router.post('/:id/checkin', async (req, res) => {
  try {
    const event = await visibleEvent(req, res, req.params.id);
    if (!event) return;
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CommunityEvent" WHERE id = ${event.id} FOR UPDATE`;
      const current = await tx.communityEvent.findUnique({ where: { id: event.id },
        select: { status: true, startsAt: true } });
      const now = new Date();
      if (!current || current.status !== 'SCHEDULED' || current.startsAt > now ||
          current.startsAt.getTime() + 2 * 3600000 < now.getTime()) return 'closed';
      const updated = await tx.eventParticipant.updateMany({ where: { eventId: event.id,
        userId: req.userId, attendedAt: null }, data: { attendedAt: now } });
      if (updated.count) return 'ok';
      return await tx.eventParticipant.findUnique({ where: { eventId_userId: {
        eventId: event.id, userId: req.userId } }, select: { attendedAt: true } }) ? 'already' : 'absent';
    }, { timeout: 15000 });
    if (result === 'closed') return res.status(409).json({ message: 'A presença só pode ser marcada nas duas horas após o início.' });
    if (result === 'absent') return res.status(403).json({ message: 'Confirme presença no evento antes de fazer check-in.' });
    if (result === 'ok') void gamification.syncAchievements(req.userId, req.app.get('io'))
      .catch(error => console.error('Falha ao conferir conquistas de evento:', error));
    res.json({ attended: true });
  } catch (error) { fail(res, error); }
});
router.put('/:id/reminder', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return bad(res, 'Escolha uma opção de lembrete.');
  try {
    const event = await visibleEvent(req, res, req.params.id);
    if (!event) return;
    const updated = await prisma.eventParticipant.updateMany({ where: { eventId: event.id,
      userId: req.userId }, data: { reminderEnabled: req.body.enabled } });
    if (!updated.count) return res.status(404).json({ message: 'Inscreva-se primeiro.' });
    res.json({ reminderEnabled: req.body.enabled });
  } catch (error) { fail(res, error); }
});
router.put('/:id/reschedule', async (req, res) => {
  try {
    const event = await visibleEvent(req, res, req.params.id, true);
    if (!event) return;
    const input = eventInput(req.body, res, { reschedule: true });
    if (!input) return;
    const updated = await prisma.communityEvent.updateMany({ where: { id: event.id,
      status: 'SCHEDULED', startsAt: { gt: new Date() } }, data: { startsAt: input.startsAt,
        timeZone: input.timeZone, scheduleVersion: { increment: 1 } } });
    if (!updated.count) return res.status(409).json({ message: 'Evento já iniciado ou cancelado.' });
    changed(req, event);
    res.json({ rescheduled: true });
  } catch (error) { fail(res, error); }
});
router.post('/:id/cancel', async (req, res) => {
  try {
    const event = await visibleEvent(req, res, req.params.id, true);
    if (!event) return;
    await prisma.communityEvent.updateMany({ where: { id: event.id, status: 'SCHEDULED' },
      data: { status: 'CANCELLED', registrationOpen: false } });
    changed(req, event);
    res.json({ cancelled: true });
  } catch (error) { fail(res, error); }
});

module.exports = router;
