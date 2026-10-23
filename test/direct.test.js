const test = require('node:test');
const assert = require('node:assert/strict');
const direct = require('../src/services/direct');

test('pares de DM são canônicos e acesso exige participação', async () => {
  assert.deepEqual(direct.pair('z', 'a'), ['a', 'z']);
  const db = { directConversation: { findUnique: async () => ({ id: 'c', userAId: 'a', userBId: 'z', requesterId: 'a', status: 'ACTIVE' }) } };
  assert.equal((await direct.access('a', 'c', db)).id, 'c');
  assert.equal((await direct.access('z', 'c', db)).id, 'c');
  assert.equal(await direct.access('intruso', 'c', db), null);
});

test('bloqueio é verificado nos dois sentidos', async () => {
  const db = { userBlock: { findFirst: async args => {
    assert.deepEqual(args.where.OR, [{ blockerId: 'a', blockedId: 'b' }, { blockerId: 'b', blockedId: 'a' }]);
    return { blockerId: 'b' };
  } } };
  assert.equal(await direct.blocked('a', 'b', db), true);
});

test('preferências de DM dependem da direção do seguimento', async () => {
  const calls = [];
  const db = { follow: { findUnique: async args => { calls.push(args.where.followerId_followedId); return null; } } };
  assert.equal(await direct.canRequest('sender', { id: 'recipient', directPrivacy: 'NOBODY' }, db), false);
  assert.equal(await direct.canRequest('sender', { id: 'recipient', directPrivacy: 'EVERYONE' }, db), true);
  assert.equal(await direct.canRequest('sender', { id: 'recipient', directPrivacy: 'FOLLOWERS' }, db), false);
  assert.equal(await direct.canRequest('sender', { id: 'recipient', directPrivacy: 'FOLLOWING' }, db), false);
  assert.deepEqual(calls, [
    { followerId: 'sender', followedId: 'recipient' },
    { followerId: 'recipient', followedId: 'sender' },
  ]);
});
