const prisma = require('../database/prisma');
const webpush = require('web-push');
const nativePush = require('./nativePush');

const categories = ['SOCIAL', 'CHAT', 'DIRECT', 'PROJECTION', 'EVENT', 'ACHIEVEMENT', 'ADMIN'];
const kinds = {
  FOLLOW: 'SOCIAL', POST_LIKE: 'SOCIAL', POST_COMMENT: 'SOCIAL', POST_FEATURED: 'SOCIAL',
  CHAT_REPLY: 'CHAT', CHAT_MESSAGE: 'CHAT', MENTION: 'CHAT', DIRECT_MESSAGE: 'DIRECT',
  PROJECTION_START: 'PROJECTION', EVENT_REMINDER: 'EVENT',
  ACHIEVEMENT_UNLOCKED: 'ACHIEVEMENT', ADMIN_WARNING: 'ADMIN',
};
const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '';
const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '';
const subject = process.env.WEB_PUSH_SUBJECT || '';
let pushAvailable = false;
if (publicKey && privateKey && /^(mailto:|https:\/\/)/.test(subject)) {
  try { webpush.setVapidDetails(subject, publicKey, privateKey); pushAvailable = true; }
  catch (error) { console.error('Configuração Web Push inválida:', error.message); }
}

function safeHref(href) {
  if (typeof href !== 'string' || href.length > 500 || !/^\/(?!\/)[^\\\r\n]*$/.test(href)) return '/notifications.html';
  return href;
}

async function sendPush(notification, db = prisma, sender = webpush) {
  if (!pushAvailable) return;
  const subscriptions = await db.pushSubscription.findMany({ where: { userId: notification.recipientId },
    take: 10, select: { id: true, endpoint: true, p256dh: true, auth: true } });
  const payload = JSON.stringify({ id: notification.id, title: notification.title,
    body: notification.body, href: notification.href, category: notification.category });
  await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await sender.sendNotification({ endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload,
      { TTL: 3600, urgency: 'normal' });
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) await db.pushSubscription.deleteMany({ where: { id: subscription.id, userId: notification.recipientId } });
      else console.error('Falha ao enviar Web Push:', error.statusCode || error.message);
    }
  }));
}

async function publish({ recipientId, actorId = null, kind, sourceKey, title, body, href, io,
  db = prisma, push = sendPush }) {
  const category = kinds[kind];
  if (!recipientId || !category || typeof sourceKey !== 'string' || sourceKey.length > 160) throw new Error('Notificação inválida.');
  const preference = await db.notificationPreference.findUnique({ where: { userId_category: { userId: recipientId, category } },
    select: { enabled: true, pushEnabled: true } });
  if (preference?.enabled === false) return null;
  let notification;
  try {
    notification = await db.notification.create({ data: { recipientId, actorId, category, kind, sourceKey,
      title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 240), href: safeHref(href) } });
  } catch (error) {
    if (error.code === 'P2002') return null;
    throw error;
  }
  io?.to(`user:${recipientId}`).emit('notification', notification);
  if (preference?.pushEnabled) {
    void push(notification, db).catch(error => console.error('Erro no Web Push:', error));
    void nativePush.sendNativePush(notification, db).catch(error => console.error('Erro no Push nativo:', error));
  }
  return notification;
}

async function publishBatch({ recipientIds, actorId = null, kind, sourcePrefix, title, body, href, io,
  db = prisma, push = sendPush }) {
  const category = kinds[kind];
  if (!category || !Array.isArray(recipientIds) || recipientIds.length > 100 || !sourcePrefix) throw new Error('Lote de notificações inválido.');
  const uniqueIds = [...new Set(recipientIds)].filter(id => id && id !== actorId);
  if (!uniqueIds.length) return [];
  const preferences = await db.notificationPreference.findMany({ where: { userId: { in: uniqueIds }, category },
    select: { userId: true, enabled: true, pushEnabled: true } });
  const preferenceByUser = new Map(preferences.map(item => [item.userId, item]));
  const data = uniqueIds.filter(id => preferenceByUser.get(id)?.enabled !== false).map(recipientId => ({
    recipientId, actorId, category, kind, sourceKey: `${sourcePrefix}:${recipientId}`,
    title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 240), href: safeHref(href),
  }));
  if (!data.length) return [];
  const created = await db.notification.createManyAndReturn({ data, skipDuplicates: true });
  for (const notification of created) {
    io?.to(`user:${notification.recipientId}`).emit('notification', notification);
    if (preferenceByUser.get(notification.recipientId)?.pushEnabled) {
      void push(notification, db).catch(error => console.error('Erro no Web Push:', error));
      void nativePush.sendNativePush(notification, db).catch(error => console.error('Erro no Push nativo:', error));
    }
  }
  return created;
}

function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
      host === 'web.push.apple.com' || host.endsWith('.notify.windows.com');
  } catch { return false; }
}

async function enableMessagePushByDefault(userId, db = prisma) {
  return db.notificationPreference.createMany({ data: ['CHAT', 'DIRECT'].map(category => ({
    userId, category, enabled: true, pushEnabled: true,
  })), skipDuplicates: true });
}

module.exports = { categories, kinds, publicKey: pushAvailable ? publicKey : '', pushAvailable,
  safeHref, validEndpoint, publish, publishBatch, sendPush, enableMessagePushByDefault };
