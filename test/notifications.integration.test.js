require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const prisma = require('../src/database/prisma');
const io = require(path.join(__dirname, '../node_modules/socket.io/client-dist/socket.io.js'));

test('central entrega eventos privados, aplica preferências e protege leitura e dispositivos', {
  skip: process.env.RUN_NOTIFICATION_LIVE_TESTS !== '1' && 'Defina RUN_NOTIFICATION_LIVE_TESTS=1 com localhost:3000 e banco migrado',
  timeout: 120000,
}, async () => {
  const base = process.env.NOTIFICATION_LIVE_URL || 'http://localhost:3000';
  const tag = randomUUID();
  const users = [];
  const sockets = [];
  let roomId;
  const token = user => jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
  const call = (user, route, method = 'GET', body) => fetch(`${base}${route}`, {
    method, headers: { Authorization: `Bearer ${token(user)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const waitEvent = (socket, event, accept = () => true) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`Evento ${event} não chegou.`)); }, 10000);
    function onEvent(payload) {
      if (!accept(payload)) return;
      clearTimeout(timer); socket.off(event, onEvent); resolve(payload);
    }
    socket.on(event, onEvent);
  });
  const eventually = async predicate => {
    for (let i = 0; i < 40; i++) {
      const found = await predicate();
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Notificação não foi persistida.');
  };
  try {
    for (const name of ['actor', 'recipient', 'outsider']) users.push(await prisma.user.create({ data: {
      username: `notice-${name}-${tag}`, email: `notice-${name}-${tag}@test.invalid`, password: 'test',
    } }));
    const [actor, recipient, outsider] = users;
    const socket = io(base, { auth: { token: token(recipient) }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await waitEvent(socket, 'connect');

    const followEvent = waitEvent(socket, 'notification');
    assert.equal((await call(actor, `/api/users/${recipient.id}/follow`, 'POST')).status, 200);
    const follow = await followEvent;
    assert.equal(follow.kind, 'FOLLOW');
    assert.equal(follow.recipientId, recipient.id);
    assert.equal((await call(actor, `/api/users/${recipient.id}/follow`, 'POST')).status, 200);
    await eventually(() => prisma.notification.findUnique({ where: { id: follow.id } }));
    assert.equal(await prisma.notification.count({ where: { sourceKey: { startsWith: `follow:${actor.id}:${recipient.id}:` } } }), 1);
    assert.equal((await call(actor, `/api/users/${recipient.id}/follow`, 'DELETE')).status, 200);
    const refollowEvent = waitEvent(socket, 'notification');
    assert.equal((await call(actor, `/api/users/${recipient.id}/follow`, 'POST')).status, 200);
    assert.equal((await refollowEvent).kind, 'FOLLOW');
    assert.equal(await prisma.notification.count({ where: { sourceKey: { startsWith: `follow:${actor.id}:${recipient.id}:` } } }), 2);
    assert.equal((await call(outsider, `/api/notifications/${follow.id}/read`, 'PATCH')).status, 404);
    assert.equal((await call(outsider, `/api/notifications/${follow.id}`, 'DELETE')).status, 404);
    assert.equal((await call(outsider, `/api/notifications/?before=${follow.id}`)).status, 400);

    const post = await prisma.post.create({ data: { userId: recipient.id, content: 'Post de teste' } });
    const likeEvent = waitEvent(socket, 'notification');
    assert.equal((await call(actor, `/api/posts/${post.id}/like`, 'POST')).status, 200);
    assert.equal((await likeEvent).kind, 'POST_LIKE');

    assert.equal((await call(recipient, '/api/notifications/preferences/categories/SOCIAL', 'PATCH', { enabled: false })).status, 200);
    const another = await prisma.user.create({ data: { username: `notice-extra-${tag}`,
      email: `notice-extra-${tag}@test.invalid`, password: 'test' } });
    users.push(another);
    assert.equal((await call(another, `/api/users/${recipient.id}/follow`, 'POST')).status, 200);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await prisma.notification.count({ where: { sourceKey: { startsWith: `follow:${another.id}:${recipient.id}:` } } }), 0);
    assert.equal((await call(recipient, '/api/notifications/preferences/categories/SOCIAL', 'PATCH', { enabled: true })).status, 200);

    const created = await call(actor, '/api/direct/conversations', 'POST', { userId: recipient.id });
    assert.equal(created.status, 201);
    const conversation = (await created.json()).conversation;
    assert.equal((await call(recipient, `/api/direct/conversations/${conversation.id}/request`, 'PATCH', { action: 'accept' })).status, 200);
    const dmEvent = waitEvent(socket, 'notification');
    const sent = await call(actor, `/api/direct/conversations/${conversation.id}/messages`, 'POST', { content: 'Aviso privado' });
    assert.equal(sent.status, 201);
    const dm = await dmEvent;
    assert.equal(dm.kind, 'DIRECT_MESSAGE');
    assert.match(dm.href, new RegExp(`conversation=${conversation.id}`));

    const listed = await call(recipient, '/api/notifications/?category=DIRECT&unread=true');
    assert.equal(listed.status, 200);
    assert.ok((await listed.json()).notifications.some(item => item.id === dm.id));
    assert.equal((await call(recipient, '/api/notifications/unread-count')).status, 200);
    const readEvent = waitEvent(socket, 'notification-read');
    assert.equal((await call(recipient, `/api/notifications/${dm.id}/read`, 'PATCH')).status, 200);
    assert.equal((await readEvent).id, dm.id);
    assert.ok((await prisma.notification.findUnique({ where: { id: dm.id } })).readAt);
    assert.equal((await call(recipient, '/api/notifications/read-all', 'PATCH')).status, 200);
    assert.deepEqual(await (await call(recipient, '/api/notifications/unread-count')).json(), { unreadCount: 0 });

    roomId = `notice-test-${tag.slice(0, 12)}`;
    await prisma.room.create({ data: { id: roomId, name: 'Teste de avisos', ownerId: actor.id } });
    const actorSocket = io(base, { auth: { token: token(actor) }, transports: ['websocket'], reconnection: false });
    sockets.push(actorSocket);
    await waitEvent(actorSocket, 'connect');
    for (const client of [socket, actorSocket]) {
      const history = waitEvent(client, 'chat-history');
      client.emit('join-room', roomId);
      await history;
    }
    const mentionEvent = waitEvent(socket, 'notification');
    const mentionMessage = waitEvent(actorSocket, 'chat-message');
    actorSocket.emit('chat-message', { roomId, message: `Olá @{${recipient.username}}`, clientKey: randomUUID() });
    const [mentioned, mention] = await Promise.all([mentionMessage, mentionEvent]);
    assert.equal(mention.kind, 'MENTION');
    assert.match(mention.href, new RegExp(`mensagem=${mentioned.id}`));

    const parentMessage = waitEvent(socket, 'chat-message');
    socket.emit('chat-message', { roomId, message: 'Pergunta de teste', clientKey: randomUUID() });
    const parent = await parentMessage;
    const replyEvent = waitEvent(socket, 'notification', payload => payload.kind === 'CHAT_REPLY');
    const replyMessage = waitEvent(actorSocket, 'chat-message');
    actorSocket.emit('chat-message', { roomId, message: 'Resposta de teste', replyToId: parent.id, clientKey: randomUUID() });
    await replyMessage;
    assert.equal((await replyEvent).kind, 'CHAT_REPLY');

    const config = await (await call(recipient, '/api/notifications/push/config')).json();
    assert.equal(config.available, true);
    assert.equal((await call(recipient, '/api/notifications/push/subscriptions', 'PUT', {
      endpoint: 'https://127.0.0.1/push', keys: { p256dh: 'a'.repeat(64), auth: 'b'.repeat(24) },
    })).status, 400);
    const endpoint = `https://fcm.googleapis.com/fcm/send/test-${tag}`;
    const deviceResponse = await call(recipient, '/api/notifications/push/subscriptions', 'PUT', {
      endpoint, keys: { p256dh: 'a'.repeat(64), auth: 'b'.repeat(24) },
    });
    assert.equal(deviceResponse.status, 201);
    const device = (await deviceResponse.json()).device;
    assert.equal((await call(outsider, `/api/notifications/push/devices/${device.id}`, 'DELETE')).status, 404);
    assert.equal((await call(recipient, `/api/notifications/push/devices/${device.id}`, 'DELETE')).status, 200);
    assert.equal((await call(recipient, `/api/notifications/${follow.id}`, 'DELETE')).status, 200);
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  }
});
