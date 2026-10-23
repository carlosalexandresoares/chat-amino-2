require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const prisma = require('../src/database/prisma');

test('moderação: denúncias, escopo, auditoria, restrições e privacidade', {
  skip: process.env.RUN_MODERATION_LIVE_TESTS !== '1' &&
    'Defina RUN_MODERATION_LIVE_TESTS=1 com servidor local e banco migrado',
  timeout: 150000,
}, async () => {
  const base = process.env.MODERATION_LIVE_URL || 'http://localhost:3000';
  const tag = randomUUID();
  const users = [];
  const createdReportIds = [];
  let createdMessageId;
  const sockets = [];
  let roomId;
  const call = async (user, path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: {
      Authorization: `Bearer ${jwt.sign({ sub: user.id }, process.env.JWT_SECRET)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const socketFor = user => new Promise((resolve, reject) => {
    const socket = io(base, { auth: { token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET) },
      transports: ['websocket'], reconnection: false, timeout: 8000 });
    sockets.push(socket); socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
  try {
    const password = await bcrypt.hash('temporary-password', 10);
    for (const name of ['owner', 'member', 'outsider', 'admin']) users.push(await prisma.user.create({
      data: { username: `mod-${name}-${tag}`, email: `mod-${name}-${tag}@test.invalid`, password,
        isSiteAdmin: name === 'admin' } }));
    const [owner, member, outsider, admin] = users;
    const room = await prisma.room.create({ data: { name: `Mod ${tag.slice(0, 8)}`,
      ownerId: owner.id, members: { create: [{ userId: owner.id, role: 'OWNER' },
        { userId: member.id, role: 'MEMBER' }] } } });
    roomId = room.id;
    const message = await prisma.message.create({ data: { roomId, userId: member.id,
      content: 'Mensagem para teste de moderação' } });
    const report = await call(owner, '/api/moderation/reports', 'POST', {
      kind: 'MESSAGE', targetId: message.id, reason: 'SPAM', details: 'Conteúdo repetido' });
    createdMessageId = message.id;
    if (report.data?.id) createdReportIds.push(report.data.id);
    assert.equal(report.status, 201);
    assert.equal((await call(owner, '/api/moderation/reports', 'POST', {
      kind: 'MESSAGE', targetId: message.id, reason: 'SPAM' })).status, 409);
    assert.equal((await call(member, `/api/moderation/reports?roomId=${roomId}`)).status, 403);
    assert.equal((await call(owner, '/api/moderation/reports')).status, 403);
    assert.equal((await call(outsider, '/api/moderation/reports', 'POST', {
      kind: 'MESSAGE', targetId: message.id, reason: 'SPAM' })).status, 404);
    const queue = await call(owner, `/api/moderation/reports?roomId=${roomId}`);
    assert.equal(queue.data.reports[0].id, report.data.id);
    assert.equal(queue.data.reports[0].subjectUserId, member.id);
    assert.equal((await call(member, `/api/moderation/reports/${report.data.id}`, 'PATCH', {
      status: 'RESOLVED', note: 'Revisto' })).status, 403);
    assert.equal((await call(owner, `/api/moderation/rooms/${roomId}/actions`, 'POST', {
      action: 'MUTE', targetUserId: owner.id, reason: 'Teste', durationMinutes: 5 })).status, 403);
    assert.equal((await call(member, `/api/moderation/rooms/${roomId}/actions`, 'POST', {
      action: 'MUTE', targetUserId: owner.id, reason: 'Teste', durationMinutes: 5 })).status, 403);
    assert.equal((await call(owner, `/api/moderation/rooms/${roomId}/actions`, 'POST', {
      action: 'MUTE', targetUserId: member.id, reason: 'Spam no chat', durationMinutes: 5 })).status, 200);
    const memberSocket = await socketFor(member);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Não entrou na sala')), 10000);
      memberSocket.once('room-permissions', () => { clearTimeout(timer); resolve(); });
      memberSocket.emit('join-room', roomId);
    });
    const rejected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Silêncio não aplicado')), 5000);
      memberSocket.once('chat-error', payload => { clearTimeout(timer); resolve(payload); });
    });
    memberSocket.emit('chat-message', { roomId, message: 'Não deve ser enviado' });
    assert.match((await rejected).message, /silenciado/i);
    assert.equal((await call(owner, `/api/moderation/rooms/${roomId}/actions`, 'POST', {
      action: 'DELETE_MESSAGE', targetUserId: member.id, targetId: message.id,
      reason: 'Conteúdo inadequado' })).status, 200);
    assert.ok((await prisma.message.findUnique({ where: { id: message.id } })).deletedAt);
    assert.equal((await call(owner, `/api/moderation/reports/${report.data.id}`, 'PATCH', {
      status: 'RESOLVED', note: 'Mensagem removida' })).status, 200);
    assert.equal((await call(owner, `/api/moderation/reports/${report.data.id}`, 'PATCH', {
      status: 'RESOLVED', note: 'De novo' })).status, 409);
    assert.ok((await call(owner, `/api/moderation/actions?roomId=${roomId}`)).data.actions.length >= 3);
    assert.equal((await call(owner, `/api/moderation/rooms/${roomId}/actions`, 'POST', {
      action: 'SUSPEND', targetUserId: member.id, reason: 'Suspensão temporária', durationMinutes: 5 })).status, 200);
    const hiddenPost = await prisma.post.create({ data: { userId: owner.id, roomId,
      content: 'Conteúdo da comunidade suspensa' } });
    const hiddenEvent = await prisma.communityEvent.create({ data: { roomId,
      creatorId: owner.id, organizerId: owner.id, type: 'CUSTOM', title: 'Evento restrito',
      description: 'Teste de acesso', startsAt: new Date(Date.now() + 86400000),
      timeZone: 'America/Sao_Paulo' } });
    assert.equal((await call(member, `/api/social/posts/${hiddenPost.id}`)).status, 404);
    assert.equal((await call(member, '/api/posts', 'POST', { content: 'Não autorizado', roomId })).status, 403);
    assert.equal((await call(member, `/api/events/${hiddenEvent.id}`)).status, 403);
    const eventList = await call(member, '/api/events');
    assert.equal(eventList.status, 200);
    assert.ok(!eventList.data.events.some(event => event.id === hiddenEvent.id));
    const suspended = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Suspensão não aplicada')), 5000);
      memberSocket.once('chat-error', payload => { clearTimeout(timer); resolve(payload); });
    });
    memberSocket.emit('join-room', roomId);
    assert.match((await suspended).message, /suspensa/i);
    assert.equal((await call(member, `/api/chat/rooms/${roomId}/messages`)).status, 403);
    assert.equal((await call(owner, `/api/moderation/rooms/${roomId}/actions`, 'POST', {
      action: 'REVOKE_SUSPEND', targetUserId: member.id, reason: 'Revisão da equipe' })).status, 200);
    assert.equal((await call(member, `/api/social/posts/${hiddenPost.id}`)).status, 200);
    assert.equal((await call(member, `/api/events/${hiddenEvent.id}`)).status, 200);
    assert.equal((await call(owner, `/api/moderation/rooms/${roomId}/actions`, 'POST', {
      action: 'REVOKE_MUTE', targetUserId: member.id, reason: 'Revisão da equipe' })).status, 200);
    const globalReport = await call(member, '/api/moderation/reports', 'POST', {
      kind: 'ROOM', targetId: roomId, reason: 'OTHER' });
    if (globalReport.data?.id) createdReportIds.push(globalReport.data.id);
    assert.equal(globalReport.status, 201);
    assert.equal((await call(owner, `/api/moderation/reports/${globalReport.data.id}`, 'PATCH', {
      status: 'DISMISSED', note: 'Sem fundamento' })).status, 403);
    assert.ok((await call(admin, '/api/moderation/reports')).data.reports.some(item => item.id === globalReport.data.id));
    assert.equal((await call(outsider, '/api/auth/privacy', 'PATCH', {
      profileVisibility: 'PRIVATE' })).status, 200);
    assert.equal((await call(owner, `/api/users/${outsider.id}`)).status, 403);
    assert.equal((await call(outsider, `/api/users/${outsider.id}`)).status, 200);
    assert.equal((await call(outsider, '/api/auth/account', 'DELETE', { password: 'wrong' })).status, 403);
    assert.equal((await call(outsider, '/api/auth/account', 'DELETE', {
      password: 'temporary-password' })).status, 200);
    assert.equal(await prisma.user.findUnique({ where: { id: outsider.id } }), null);
    await prisma.roomMember.update({ where: { userId_roomId: { userId: member.id, roomId } },
      data: { role: 'CO_ADMIN' } });
    assert.equal((await call(owner, '/api/auth/account', 'DELETE', {
      password: 'temporary-password' })).status, 200);
    const transferred = await prisma.room.findUnique({ where: { id: roomId },
      include: { members: { where: { userId: member.id } } } });
    assert.equal(transferred.ownerId, member.id);
    assert.equal(transferred.members[0].role, 'OWNER');
    assert.equal((await call(member, '/api/auth/account', 'DELETE', {
      password: 'temporary-password' })).status, 200);
    assert.equal(await prisma.room.findUnique({ where: { id: roomId } }), null);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    if (createdReportIds.length) await prisma.moderationReport.deleteMany({
      where: { id: { in: createdReportIds } },
    });
    const auditTargets = [roomId, createdMessageId, ...users.map(user => user.id)].filter(Boolean);
    if (auditTargets.length) await prisma.moderationAction.deleteMany({
      where: { targetId: { in: auditTargets } },
    });
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    for (const user of users.reverse()) await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
