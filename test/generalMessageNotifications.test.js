const test = require('node:test');
const assert = require('node:assert/strict');
const general = require('../src/services/generalMessageNotifications');

test('chat geral avisa usuários com celular, sem duplicar menção, resposta ou autor', async () => {
  const ids = ['actor', 'mentioned', 'replied', ...Array.from({ length: 101 }, (_, i) => `user-${String(i).padStart(3, '0')}`)];
  const batches = [];
  const db = { user: { findMany: async ({ where, take, cursor, skip }) => {
    assert.equal(take, 100);
    assert.deepEqual(where.id.notIn, ['actor', 'mentioned', 'replied']);
    assert.deepEqual(where.nativePushDevices, { some: {} });
    const eligible = ids.filter(id => !where.id.notIn.includes(id));
    const start = cursor ? eligible.indexOf(cursor.id) + skip : 0;
    return eligible.slice(start, start + take).map(id => ({ id }));
  } } };
  await general.publish({ db, notifications: { publishBatch: async batch => batches.push(batch) },
    messageId: 'm1', actor: { id: 'actor', username: 'Ana' },
    excludedIds: ['mentioned', 'replied', 'mentioned'], href: '/index.html?sala=geral&mensagem=m1' });
  assert.deepEqual(batches.map(batch => batch.recipientIds.length), [100, 1]);
  assert.equal(batches[0].kind, 'CHAT_MESSAGE');
  assert.equal(batches[0].sourcePrefix, 'chat:m1');
  assert.equal(batches[0].body, 'Ana enviou uma mensagem.');
  assert.equal(batches[0].db, db);
});
