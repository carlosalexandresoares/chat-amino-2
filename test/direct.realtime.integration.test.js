require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const prisma = require('../src/database/prisma');
const io = require(path.join(__dirname, '../node_modules/socket.io/client-dist/socket.io.js'));

test('DM em servidor local entrega digitação, reconexão e leitura entre duas contas', {
  skip: process.env.RUN_DIRECT_LIVE_TESTS !== '1' && 'Defina RUN_DIRECT_LIVE_TESTS=1 com localhost:3000 e banco migrado',
  timeout: 120000,
}, async () => {
  const tag = randomUUID();
  const users = [];
  const sockets = [];
  let roomId;
  const base = process.env.DIRECT_LIVE_URL || 'http://localhost:3000';
  const waitEvent = (socket, event) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`Evento ${event} não recebido.`)); }, 10000);
    function onEvent(payload) { clearTimeout(timer); resolve(payload); }
    socket.once(event, onEvent);
  });
  const connect = user => new Promise((resolve, reject) => {
    const socket = io(base, { auth: { token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET) },
      transports: ['websocket'], reconnection: false, timeout: 10000 });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  const call = (user, endpoint, options = {}) => fetch(`${base}/api/direct${endpoint}`, {
    ...options, headers: { Authorization: `Bearer ${jwt.sign({ sub: user.id }, process.env.JWT_SECRET)}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  try {
    for (const name of ['sender', 'recipient']) users.push(await prisma.user.create({ data: {
      username: `direct-live-${name}-${tag}`, email: `direct-live-${name}-${tag}@test.invalid`, password: 'test',
    } }));
    const [sender, recipient] = users;
    const started = await call(sender, '/conversations', { method: 'POST', body: JSON.stringify({ userId: recipient.id }) });
    assert.equal(started.status, 201);
    const conversation = (await started.json()).conversation;
    assert.equal((await call(recipient, `/conversations/${conversation.id}/request`, { method: 'PATCH',
      body: JSON.stringify({ action: 'accept' }) })).status, 200);

    const senderSocket = await connect(sender);
    const recipientSocket = await connect(recipient);
    const typing = waitEvent(recipientSocket, 'direct-typing');
    senderSocket.emit('direct-typing', { conversationId: conversation.id, typing: true });
    assert.deepEqual(await typing, { conversationId: conversation.id, userId: sender.id, typing: true });

    recipientSocket.disconnect();
    const sent = await call(sender, `/conversations/${conversation.id}/messages`, { method: 'POST',
      body: JSON.stringify({ content: 'Mensagem após desconexão' }) });
    assert.equal(sent.status, 201);
    const message = (await sent.json()).message;
    assert.equal(message.deliveredAt, null);

    await connect(recipient);
    assert.equal((await call(recipient, '/conversations')).status, 200);
    let stored = await prisma.directMessage.findUnique({ where: { id: message.id }, select: { deliveredAt: true, readAt: true } });
    assert.ok(stored.deliveredAt);
    assert.equal(stored.readAt, null);
    const read = waitEvent(senderSocket, 'direct-read');
    assert.equal((await call(recipient, `/conversations/${conversation.id}/messages`)).status, 200);
    assert.equal((await read).conversationId, conversation.id);
    stored = await prisma.directMessage.findUnique({ where: { id: message.id }, select: { readAt: true } });
    assert.ok(stored.readAt);

    roomId = `direct-test-${tag.slice(0, 12)}`;
    await prisma.room.create({ data: { id: roomId, name: 'Teste de menções', ownerId: sender.id } });
    for (const socket of [senderSocket, sockets.at(-1)]) {
      const joined = waitEvent(socket, 'chat-history');
      socket.emit('join-room', roomId);
      await joined;
    }
    const mentionNotice = waitEvent(sockets.at(-1), 'chat-mention');
    const broadcast = waitEvent(senderSocket, 'chat-message');
    senderSocket.emit('chat-message', { roomId, message: `Olá @{${recipient.username}}`, clientKey: randomUUID() });
    const [mentionedMessage, notice] = await Promise.all([broadcast, mentionNotice]);
    assert.equal(mentionedMessage.mentions[0].id, recipient.id);
    assert.equal(notice.messageId, mentionedMessage.id);
    assert.ok(await prisma.chatMention.findFirst({ where: { messageId: mentionedMessage.id, userId: recipient.id } }));

    const updatedStatus = await call(sender, '/settings', { method: 'PATCH', body: JSON.stringify({
      presenceStatus: 'INVISIBLE', statusText: 'Ocupado',
    }) });
    assert.equal(updatedStatus.status, 200);
    const otherView = await fetch(`${base}/api/users/${sender.id}`, { headers: {
      Authorization: `Bearer ${jwt.sign({ sub: recipient.id }, process.env.JWT_SECRET)}`,
    } });
    assert.equal(otherView.status, 200);
    assert.equal((await otherView.json()).user.presenceStatus, null);
    const ownView = await fetch(`${base}/api/users/${sender.id}`, { headers: {
      Authorization: `Bearer ${jwt.sign({ sub: sender.id }, process.env.JWT_SECRET)}`,
    } });
    assert.equal((await ownView.json()).user.presenceStatus, 'INVISIBLE');
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  }
});
