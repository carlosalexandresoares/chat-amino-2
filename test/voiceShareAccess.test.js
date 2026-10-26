const test = require('node:test');
const assert = require('node:assert/strict');
const moderation = require('../src/services/moderation');
const { createVoiceService } = require('../src/services/voiceRooms');

test('tela e sinais WebRTC exigem participação na mesma sala de voz', async () => {
  const originalSanction = moderation.activeSanction;
  moderation.activeSanction = async () => null;
  try {
    const sent = [];
    const room = { id: 'voiceroom123', roomId: 'geral', name: 'Sala', status: 'OPEN', linkedLiveId: null };
    const prisma = {
      voiceRoom: { findUnique: async () => room },
      roomMember: { findUnique: async ({ where }) =>
        where.userId_roomId.userId === 'outsider' ? null : { role: 'MEMBER' } },
    };
    const io = { to: target => ({ emit: (name, payload) => sent.push({ target, name, payload }) }) };
    const service = createVoiceService({ io, prisma, getActiveLive: () => null });
    function socket(id, roomAccess = true) {
      const handlers = new Map();
      const client = { id, user: { id, username: id, avatar: null, presenceStatus: 'ONLINE' },
        rooms: new Set(roomAccess ? [id, 'geral'] : [id]),
        on: (name, handler) => handlers.set(name, handler),
        emit: (name, payload) => sent.push({ target: id, name, payload }),
        join: name => client.rooms.add(name),
        leave: name => client.rooms.delete(name),
        request: (name, payload = {}) => new Promise(resolve => handlers.get(name)(payload, resolve)),
        disconnect: () => handlers.get('disconnecting')(),
      };
      service.attach(client);
      return client;
    }
    const alice = socket('alice');
    const bob = socket('bob');
    const outsider = socket('outsider', false);
    assert.equal((await outsider.request('voice:join', { voiceRoomId: room.id })).success, false);
    assert.equal((await alice.request('voice:join', { voiceRoomId: room.id })).success, true);
    assert.equal((await bob.request('voice:join', { voiceRoomId: room.id })).success, true);
    assert.equal((await outsider.request('voice:share', { sharing: true })).success, false);
    assert.equal((await alice.request('voice:share', { sharing: true })).success, true);
    assert.equal((await bob.request('voice:share', { sharing: true })).success, false);
    assert.equal((await outsider.request('voice:signal', { to: 'bob', type: 'offer',
      data: { sdp: 'fake' } })).success, false);
    assert.equal((await alice.request('voice:signal', { to: 'bob', type: 'offer',
      data: { sdp: 'fake' } })).success, true);
    assert.equal((await bob.request('voice:signal', { to: 'alice', type: 'screen-offer',
      data: { sdp: 'fake' } })).success, false);
    assert.equal((await alice.request('voice:signal', { to: 'bob', type: 'screen-offer',
      data: { sdp: 'fake' } })).success, true);
    assert.equal((await bob.request('voice:signal', { to: 'alice', type: 'screen-answer',
      data: { sdp: 'fake' } })).success, true);
    assert.equal((await outsider.request('voice:signal', { to: 'alice', type: 'screen-candidate',
      data: { candidate: 'fake' } })).success, false);
    assert.ok(sent.some(item => item.target === 'bob' && item.name === 'voice:signal'));
    alice.disconnect();
    assert.ok(sent.some(item => item.name === 'voice:participants' &&
      item.payload.participants.every(person => !person.sharing)));
    assert.equal((await bob.request('voice:share', { sharing: true })).success, true);
  } finally {
    moderation.activeSanction = originalSanction;
  }
});
