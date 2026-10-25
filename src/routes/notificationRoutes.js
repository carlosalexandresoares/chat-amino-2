const express = require('express');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const notifications = require('../services/notifications');
const nativePush = require('../services/nativePush');

const router = express.Router();
router.use(auth);
const fail = (res, error) => { console.error('Erro nas notificações:', error);
  res.status(500).json({ message: 'Não foi possível carregar as notificações.' }); };

router.get('/unread-count', async (req, res) => {
  try { res.json({ unreadCount: await prisma.notification.count({ where: { recipientId: req.userId, readAt: null } }) }); }
  catch (error) { fail(res, error); }
});

router.get('/', async (req, res) => {
  try {
    const category = req.query.category;
    if (category && !notifications.categories.includes(category)) return res.status(400).json({ message: 'Categoria inválida.' });
    const unread = req.query.unread === 'true';
    const beforeId = req.query.before;
    const before = beforeId ? await prisma.notification.findFirst({ where: { id: String(beforeId), recipientId: req.userId },
      select: { id: true, createdAt: true } }) : null;
    if (beforeId && !before) return res.status(400).json({ message: 'Marcador inválido.' });
    const rows = await prisma.notification.findMany({ where: { recipientId: req.userId,
      ...(category ? { category } : {}), ...(unread ? { readAt: null } : {}),
      ...(before ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] } : {}),
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31,
    select: { id: true, category: true, kind: true, title: true, body: true, href: true,
      actor: { select: { id: true, username: true, avatar: true } }, createdAt: true, readAt: true } });
    res.json({ notifications: rows.slice(0, 30), hasMore: rows.length > 30,
      nextCursor: rows.length > 30 ? rows[29].id : null });
  } catch (error) { fail(res, error); }
});

router.patch('/read-all', async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({ where: { recipientId: req.userId, readAt: null }, data: { readAt: new Date() } });
    req.app.get('io').to(`user:${req.userId}`).emit('notifications-read-all');
    res.json({ updated: result.count });
  } catch (error) { fail(res, error); }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({ where: { id: req.params.id, recipientId: req.userId, readAt: null },
      data: { readAt: new Date() } });
    if (!result.count && !await prisma.notification.findFirst({ where: { id: req.params.id, recipientId: req.userId }, select: { id: true } }))
      return res.sendStatus(404);
    req.app.get('io').to(`user:${req.userId}`).emit('notification-read', { id: req.params.id });
    res.json({ read: true });
  } catch (error) { fail(res, error); }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await prisma.notification.deleteMany({ where: { id: req.params.id, recipientId: req.userId } });
    if (!result.count) return res.sendStatus(404);
    req.app.get('io').to(`user:${req.userId}`).emit('notification-deleted', { id: req.params.id });
    res.json({ deleted: true });
  } catch (error) { fail(res, error); }
});

router.get('/preferences/categories', async (req, res) => {
  try {
    const rows = await prisma.notificationPreference.findMany({ where: { userId: req.userId } });
    const saved = new Map(rows.map(item => [item.category, item]));
    res.json({ preferences: notifications.categories.map(category => ({ category,
      enabled: saved.get(category)?.enabled ?? true, pushEnabled: saved.get(category)?.pushEnabled ?? false })) });
  } catch (error) { fail(res, error); }
});

router.patch('/preferences/categories/:category', async (req, res) => {
  const category = req.params.category;
  const { enabled, pushEnabled } = req.body || {};
  if (!notifications.categories.includes(category) || (enabled !== undefined && typeof enabled !== 'boolean') ||
    (pushEnabled !== undefined && typeof pushEnabled !== 'boolean') || (enabled === undefined && pushEnabled === undefined))
    return res.status(400).json({ message: 'Preferência inválida.' });
  try {
    const preference = await prisma.notificationPreference.upsert({ where: { userId_category: { userId: req.userId, category } },
      create: { userId: req.userId, category, enabled: enabled ?? true, pushEnabled: pushEnabled ?? false },
      update: { ...(enabled !== undefined ? { enabled } : {}), ...(pushEnabled !== undefined ? { pushEnabled } : {}) } });
    res.json({ preference });
  } catch (error) { fail(res, error); }
});

router.get('/push/config', (_req, res) => res.json({ available: notifications.pushAvailable,
  publicKey: notifications.publicKey }));

router.get('/native-push/config', (_req, res) => res.json({ available: nativePush.available }));

router.get('/native-push/devices', async (req, res) => {
  try {
    const devices = await prisma.nativePushDevice.findMany({ where: { userId: req.userId },
      select: { id: true, platform: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 });
    res.json({ devices });
  } catch (error) { fail(res, error); }
});

router.put('/native-push/devices', async (req, res) => {
  const { platform, token } = req.body || {};
  if (!nativePush.validToken(platform, token))
    return res.status(400).json({ message: 'Dispositivo inválido.' });
  if (!nativePush.available[platform])
    return res.status(503).json({ message: 'Notificações nativas não configuradas neste servidor.' });
  try {
    const existing = await prisma.nativePushDevice.findUnique({ where: { token }, select: { id: true } });
    if (!existing && await prisma.nativePushDevice.count({ where: { userId: req.userId } }) >= 10)
      return res.status(429).json({ message: 'Limite de dispositivos atingido.' });
    const device = await prisma.nativePushDevice.upsert({ where: { token },
      create: { userId: req.userId, platform, token },
      update: { userId: req.userId, platform }, select: { id: true, platform: true } });
    await notifications.enableMessagePushByDefault(req.userId);
    res.status(201).json({ device });
  } catch (error) { fail(res, error); }
});

router.delete('/native-push/devices', async (req, res) => {
  const { platform, token } = req.body || {};
  if (!nativePush.validToken(platform, token))
    return res.status(400).json({ message: 'Dispositivo inválido.' });
  try {
    await prisma.nativePushDevice.deleteMany({ where: { userId: req.userId, platform, token } });
    res.json({ deleted: true });
  } catch (error) { fail(res, error); }
});

router.get('/push/devices', async (req, res) => {
  try {
    const devices = await prisma.pushSubscription.findMany({ where: { userId: req.userId },
      select: { id: true, endpoint: true, deviceLabel: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 });
    res.json({ devices });
  } catch (error) { fail(res, error); }
});

router.put('/push/subscriptions', async (req, res) => {
  if (!notifications.pushAvailable) return res.status(503).json({ message: 'Web Push não está configurado neste servidor.' });
  const { endpoint, keys } = req.body || {};
  if (!notifications.validEndpoint(endpoint) || !keys ||
    ![keys.p256dh, keys.auth].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(value)))
    return res.status(400).json({ message: 'Inscrição inválida.' });
  try {
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint }, select: { id: true, userId: true } });
    if (!existing && await prisma.pushSubscription.count({ where: { userId: req.userId } }) >= 10)
      return res.status(429).json({ message: 'Limite de dispositivos atingido.' });
    const deviceLabel = String(req.get('user-agent') || 'Dispositivo').slice(0, 120);
    const device = await prisma.pushSubscription.upsert({ where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceLabel, userId: req.userId },
      update: { p256dh: keys.p256dh, auth: keys.auth, deviceLabel, userId: req.userId },
      select: { id: true, deviceLabel: true, createdAt: true } });
    res.status(201).json({ device });
  } catch (error) { fail(res, error); }
});

router.delete('/push/devices/:id', async (req, res) => {
  try {
    const result = await prisma.pushSubscription.deleteMany({ where: { id: req.params.id, userId: req.userId } });
    if (!result.count) return res.sendStatus(404);
    res.json({ deleted: true });
  } catch (error) { fail(res, error); }
});

router.delete('/push/subscriptions', async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!notifications.validEndpoint(endpoint)) return res.status(400).json({ message: 'Inscrição inválida.' });
  try {
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.userId } });
    res.json({ deleted: true });
  } catch (error) { fail(res, error); }
});

module.exports = router;
