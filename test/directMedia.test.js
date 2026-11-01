const test = require('node:test');
const assert = require('node:assert/strict');
const { createDirectMediaService } = require('../src/services/directMedia');

function setup() {
  const sockets = new Map();
  const rooms = new Map();
  const io = { to(room) { return { emit(event, payload) {
    for (const id of rooms.get(room) || []) sockets.get(id)?.emit(event, payload);
  } }; } };
  const prisma = {
    directConversation: { findUnique: async ({ where }) => where.id === 'dm1' ?
      { id: 'dm1', userAId: 'a', userBId: 'b', status: 'ACTIVE' } : null },
    userBlock: { findFirst: async () => null },
  };
  const service = createDirectMediaService({ io, prisma, iceServers: [] });
  function socket(id, userId) {
    const handlers = new Map();
    const received = [];
    const value = { id, user: { id: userId, username: userId }, received,
      on(event, handler) { handlers.set(event, handler); },
      emit(event, payload) { received.push({ event, payload }); },
      join(room) { if (!rooms.has(room)) rooms.set(room, new Set()); rooms.get(room).add(id); },
      leave(room) { rooms.get(room)?.delete(id); },
      send(event, payload) { return new Promise(resolve => handlers.get(event)(payload, resolve)); },
    };
    sockets.set(id, value); service.attach(value); return value;
  }
  return { socket, prisma };
}

test('mídia privada só aceita participantes e não encaminha sinal a terceiros', async () => {
  const { socket } = setup();
  const a = socket('sa', 'a'); const b = socket('sb', 'b'); const outsider = socket('sx', 'x');
  assert.equal((await outsider.send('direct-media:join', { conversationId: 'dm1' })).success, false);
  assert.equal((await a.send('direct-media:join', { conversationId: 'dm1' })).success, true);
  assert.equal((await b.send('direct-media:join', { conversationId: 'dm1' })).success, true);
  assert.equal((await a.send('direct-media:signal', { to: 'sx', type: 'offer', data: { sdp: 'offer' } })).success, false);
  assert.equal((await a.send('direct-media:signal', { to: 'sb', type: 'offer', data: { sdp: 'offer' } })).success, false);
  assert.equal((await a.send('direct-media:signal', { to: 'sb', type: 'screen-offer', data: { sdp: 'offer' } })).success, false);
  assert.equal((await a.send('direct-media:share', { sharing: true })).success, true);
  assert.equal((await b.send('direct-media:share', { sharing: true })).success, false);
  assert.equal((await a.send('direct-media:signal', { to: 'sb', type: 'screen-offer', data: { sdp: 'offer' } })).success, true);
  assert.equal(b.received.some(item => item.event === 'direct-media:signal'), true);
});

test('vídeo sincronizado preserva estado para quem entra depois e encerra ao sair', async () => {
  const { socket } = setup();
  const a = socket('sa', 'a'); const b = socket('sb', 'b');
  await a.send('direct-media:join', { conversationId: 'dm1' });
  const loaded = await a.send('direct-media:watch', { action: 'load', videoId: 'dQw4w9WgXcQ' });
  assert.equal(loaded.watch.videoId, 'dQw4w9WgXcQ');
  await a.send('direct-media:watch', { action: 'seek', position: 32 });
  await a.send('direct-media:watch', { action: 'play' });
  const joined = await b.send('direct-media:join', { conversationId: 'dm1' });
  assert.equal(joined.watch.playing, true);
  assert.ok(joined.watch.position >= 32);
  await a.send('direct-media:leave', {});
  assert.equal(b.received.at(-1).payload.watch, null);
});
