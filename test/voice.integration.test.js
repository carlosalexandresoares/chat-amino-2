require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const prisma = require('../src/database/prisma');

test('voz: acesso, criação, sinalização, moderação e limite de salas', {
  skip: process.env.RUN_VOICE_LIVE_TESTS !== '1' &&
    'Defina RUN_VOICE_LIVE_TESTS=1 com servidor local e banco migrado',
  timeout: 120000,
}, async t => {
  const base = process.env.VOICE_LIVE_URL || 'http://localhost:3000';
  const tag = randomUUID();
  const users = [];
  const sockets = [];
  let roomId;
  const request = (socket, event, payload = {}) => new Promise((resolve, reject) =>
    socket.timeout(8000).emit(event, payload, (error, result) =>
      error ? reject(error) : resolve(result)));
  const connect = user => new Promise((resolve, reject) => {
    const socket = io(base, { auth: { token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET) },
      transports: ['websocket'], reconnection: false, timeout: 8000 });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  const joinChat = socket => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sala não carregou')), 10000);
    socket.once('room-permissions', payload => { clearTimeout(timer); resolve(payload); });
    socket.emit('join-room', roomId);
  });
  try {
    for (const name of ['owner', 'member', 'outsider']) users.push(await prisma.user.create({
      data: { username: `voice-${name}-${tag}`, email: `voice-${name}-${tag}@test.invalid`, password: 'test' },
    }));
    const [owner, member, outsider] = users;
    const room = await prisma.room.create({ data: { name: `Voice ${tag.slice(0, 8)}`,
      ownerId: owner.id, members: { create: [
        { userId: owner.id, role: 'OWNER' }, { userId: member.id, role: 'MEMBER' },
      ] } } });
    roomId = room.id;
    const [hostSocket, memberSocket, outsideSocket] = await Promise.all(users.map(connect));
    assert.equal((await request(outsideSocket, 'voice:list', { roomId })).success, false);
    assert.equal((await request(outsideSocket, 'voice:create', {
      roomId, name: 'Impropria', linkProjection: false })).success, false);
    assert.equal((await joinChat(hostSocket)).role, 'OWNER');
    assert.equal((await joinChat(memberSocket)).role, 'MEMBER');
    assert.equal((await request(memberSocket, 'voice:create', {
      roomId, name: 'Impropria', linkProjection: false })).success, false);
    assert.equal((await request(hostSocket, 'voice:create', {
      roomId, name: 'Projeção inexistente', linkProjection: true })).success, false);
    const created = await request(hostSocket, 'voice:create', {
      roomId, name: 'Conversa', linkProjection: false });
    assert.equal(created.success, true);
    const voiceRoomId = created.voiceRoomId;
    assert.equal((await request(outsideSocket, 'voice:join', { voiceRoomId })).success, false);
    const hostJoin = await request(hostSocket, 'voice:join', { voiceRoomId });
    assert.equal(hostJoin.success, true);
    assert.equal(hostJoin.peers.length, 0);
    const memberJoin = await request(memberSocket, 'voice:join', { voiceRoomId });
    assert.equal(memberJoin.success, true);
    assert.equal(memberJoin.peers.length, 1);
    assert.equal((await request(memberSocket, 'voice:join', { voiceRoomId })).success, false);
    const delivered = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sinal não entregue')), 5000);
      memberSocket.once('voice:signal', payload => { clearTimeout(timer); resolve(payload); });
    });
    assert.equal((await request(hostSocket, 'voice:signal', { to: memberSocket.id,
      type: 'offer', data: { sdp: 'test-sdp' } })).success, true);
    assert.deepEqual(await delivered, { from: hostSocket.id, type: 'offer', data: { sdp: 'test-sdp' } });
    assert.equal((await request(outsideSocket, 'voice:signal', { to: memberSocket.id,
      type: 'offer', data: { sdp: 'test-sdp' } })).success, false);
    assert.equal((await request(memberSocket, 'voice:moderate', { voiceRoomId,
      targetSocketId: hostSocket.id, action: 'mute' })).success, false);
    assert.equal((await request(hostSocket, 'voice:moderate', { voiceRoomId,
      targetSocketId: memberSocket.id, action: 'mute' })).success, true);
    assert.equal((await request(memberSocket, 'voice:self-mute', { muted: false })).success, false);
    assert.equal((await request(hostSocket, 'voice:moderate', { voiceRoomId,
      targetSocketId: memberSocket.id, action: 'unmute' })).success, true);
    assert.equal((await request(memberSocket, 'voice:self-mute', { muted: false })).success, true);
    assert.equal((await request(hostSocket, 'voice:moderate', { voiceRoomId,
      targetSocketId: memberSocket.id, action: 'remove' })).success, true);
    assert.equal((await request(memberSocket, 'voice:join', { voiceRoomId })).success, false);
    await joinChat(outsideSocket);
    assert.equal((await request(outsideSocket, 'voice:join', { voiceRoomId })).success, true);
    for (let index = 0; index < 4; index++) {
      const user = await prisma.user.create({ data: { username: `voice-guest${index}-${tag}`,
        email: `voice-guest${index}-${tag}@test.invalid`, password: 'test' } });
      users.push(user);
      const guestSocket = await connect(user);
      await joinChat(guestSocket);
      assert.equal((await request(guestSocket, 'voice:join', { voiceRoomId })).success, true);
    }
    assert.equal((await request(hostSocket, 'voice:list', { roomId })).rooms[0].participantCount, 6);
    const seventh = await prisma.user.create({ data: { username: `voice-seventh-${tag}`,
      email: `voice-seventh-${tag}@test.invalid`, password: 'test' } });
    users.push(seventh);
    const seventhSocket = await connect(seventh);
    await joinChat(seventhSocket);
    assert.equal((await request(seventhSocket, 'voice:join', { voiceRoomId })).success, false);
    let receivedSignals = 0;
    outsideSocket.on('voice:signal', () => { receivedSignals++; });
    const startedAt = performance.now();
    const signals = await Promise.all(Array.from({ length: 30 }, (_, index) =>
      request(hostSocket, 'voice:signal', { to: outsideSocket.id, type: 'candidate',
        data: { candidate: `candidate-${index}`, sdpMid: '0', sdpMLineIndex: 0 } })));
    const elapsedMs = Math.round(performance.now() - startedAt);
    assert.ok(signals.every(result => result.success));
    assert.equal(receivedSignals, 30);
    t.diagnostic(`30 sinais com 6 participantes: ${elapsedMs} ms`);
    for (let index = 0; index < 2; index++) assert.equal((await request(hostSocket, 'voice:create', {
      roomId, name: `Sala ${index}`, linkProjection: false })).success, true);
    assert.equal((await request(hostSocket, 'voice:create', {
      roomId, name: 'Quarta sala', linkProjection: false })).success, false);
    assert.equal((await request(hostSocket, 'voice:close', { voiceRoomId })).success, true);
    assert.equal((await request(hostSocket, 'voice:join', { voiceRoomId })).success, false);
    assert.equal((await request(hostSocket, 'voice:list', { roomId })).rooms.length, 2);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    for (const user of users.reverse()) await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
