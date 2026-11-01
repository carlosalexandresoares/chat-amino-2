const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../src/database/prisma');
const moderation = require('../src/services/moderation');
const notifications = require('../src/services/notifications');
const gamification = require('../src/services/gamification');
const roomRoutes = require('../src/routes/roomRoutes');

test('chat privado exige convite antes de revelar sala e participantes', async () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalSanction = moderation.activeSanction;
  const originalPublish = notifications.publish;
  const originalSync = gamification.syncAchievements;
  moderation.activeSanction = async () => null;
  gamification.syncAchievements = async () => {};
  let invitation;
  let createdData;
  notifications.publish = async input => { invitation = input; return { id: 'notice-1' }; };
  process.env.JWT_SECRET = 'private-room-test-secret';
  const members = new Set(['owner']);
  const room = { id: 'private12345', ownerId: 'owner', name: 'Grupo fechado',
    description: '', category: null, isPrivate: true, inviteCode: 'a'.repeat(32),
    _count: { members: 1 } };
  const original = {
    userFindUnique: prisma.user.findUnique,
    userFindFirst: prisma.user.findFirst,
    roomFindUnique: prisma.room.findUnique,
    roomFindMany: prisma.room.findMany,
    memberFindUnique: prisma.roomMember.findUnique,
    memberUpsert: prisma.roomMember.upsert,
    memberCount: prisma.roomMember.count,
    memberFindMany: prisma.roomMember.findMany,
    transaction: prisma.$transaction,
    notificationCount: prisma.notification.count,
  };
  prisma.user.findUnique = async ({ where }) => ({ id: where.id, username: where.id });
  prisma.user.findFirst = async ({ where }) => where.username.equals === 'friend' ? { id: 'friend' } : null;
  prisma.room.findUnique = async ({ where }) => where.id === room.id ? room : null;
  prisma.room.findMany = async ({ where }) => where.isPrivate && members.has(where.members.some.userId) ? [room] : [];
  prisma.roomMember.findUnique = async ({ where }) => members.has(where.userId_roomId.userId)
    ? { role: where.userId_roomId.userId === 'owner' ? 'OWNER' : 'MEMBER' } : null;
  prisma.roomMember.upsert = async ({ where }) => { members.add(where.userId_roomId.userId); return {}; };
  prisma.roomMember.count = async () => members.size;
  prisma.roomMember.findMany = async () => [...members].map(id => ({ role: id === 'owner' ? 'OWNER' : 'MEMBER',
    user: { id, username: id, avatar: null } }));
  prisma.$transaction = async callback => callback({
    $queryRaw: async () => [{ id: room.id }], roomMember: prisma.roomMember,
    communitySanction: { findFirst: async () => null },
    room: { create: async ({ data }) => { createdData = data; return { id: 'created123' }; } },
  });
  prisma.notification.count = async () => 0;
  const app = express(); app.use(express.json());
  app.set('io', { sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to: () => ({ emit() {} }) });
  app.use('/api/rooms', roomRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (user, path, method = 'GET', body) => fetch(base + path, {
    method, headers: { Authorization: `Bearer ${jwt.sign({ sub: user }, process.env.JWT_SECRET)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    const created = await call('owner', '/api/rooms', 'POST', { name: 'Novo grupo', topic: 'GERAL', isPrivate: 'true' });
    assert.equal(created.status, 201);
    assert.equal(createdData.isPrivate, true);
    assert.match(createdData.inviteCode, /^[a-zA-Z0-9_-]{32}$/);
    assert.equal((await call('outsider', `/api/rooms/${room.id}/summary`)).status, 404);
    assert.equal((await call('outsider', `/api/rooms/${room.id}/members`)).status, 404);
    assert.deepEqual((await (await call('outsider', '/api/rooms/private')).json()).rooms, []);
    assert.equal((await call('outsider', `/api/rooms/invites/${'x'.repeat(31)}/join`, 'POST')).status, 404);
    assert.equal((await call('outsider', `/api/rooms/invites/${room.inviteCode}/join`, 'POST')).status, 200);
    assert.equal((await call('outsider', `/api/rooms/${room.id}/summary`)).status, 200);
    assert.equal((await call('outsider', `/api/rooms/${room.id}/members`)).status, 200);
    assert.equal((await (await call('outsider', '/api/rooms/private')).json()).rooms.length, 1);
    const invited = await call('owner', `/api/rooms/${room.id}/invite-user`, 'POST', { username: 'friend' });
    assert.equal(invited.status, 200);
    assert.equal(invitation.kind, 'ROOM_INVITE');
    assert.equal(invitation.recipientId, 'friend');
    assert.equal(invitation.href, `/index.html?convite=${room.inviteCode}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    prisma.user.findUnique = original.userFindUnique;
    prisma.user.findFirst = original.userFindFirst;
    prisma.room.findUnique = original.roomFindUnique;
    prisma.room.findMany = original.roomFindMany;
    prisma.roomMember.findUnique = original.memberFindUnique;
    prisma.roomMember.upsert = original.memberUpsert;
    prisma.roomMember.count = original.memberCount;
    prisma.roomMember.findMany = original.memberFindMany;
    prisma.$transaction = original.transaction;
    prisma.notification.count = original.notificationCount;
    moderation.activeSanction = originalSanction;
    notifications.publish = originalPublish;
    gamification.syncAchievements = originalSync;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
