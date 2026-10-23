const test = require('node:test');
const assert = require('node:assert/strict');
const notifications = require('../src/services/notifications');

test('notificações respeitam categoria desligada e chave idempotente', async () => {
  let creates = 0;
  const db = { notificationPreference: { findUnique: async () => ({ enabled: false, pushEnabled: true }) },
    notification: { create: async () => { creates++; return {}; } } };
  assert.equal(await notifications.publish({ db, recipientId: 'one', kind: 'FOLLOW', sourceKey: 'follow:one',
    title: 'Novo seguidor', body: 'Alguém seguiu.', href: '/perfil.html' }), null);
  assert.equal(creates, 0);
  db.notificationPreference.findUnique = async () => null;
  db.notification.create = async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); };
  assert.equal(await notifications.publish({ db, recipientId: 'one', kind: 'FOLLOW', sourceKey: 'follow:one',
    title: 'Novo seguidor', body: 'Alguém seguiu.', href: '/perfil.html' }), null);
});

test('notificação nova vai ao destinatário e lote elimina destinatários repetidos', async () => {
  const emitted = [];
  const io = { to(room) { return { emit(event, payload) { emitted.push([room, event, payload]); } }; } };
  const row = { id: 'n1', recipientId: 'one', title: 'Aviso', body: 'Corpo', href: '/index.html' };
  const db = { notificationPreference: {
    findUnique: async () => ({ enabled: true, pushEnabled: false }),
    findMany: async () => [],
  }, notification: {
    create: async () => row,
    createManyAndReturn: async ({ data, skipDuplicates }) => {
      assert.equal(skipDuplicates, true); return data.map((item, index) => ({ id: String(index), ...item }));
    },
  } };
  assert.equal(await notifications.publish({ db, io, recipientId: 'one', kind: 'MENTION',
    sourceKey: 'mention:m1:one', title: 'Aviso', body: 'Corpo', href: '//evil.example' }), row);
  assert.equal(emitted[0][0], 'user:one');
  const batch = await notifications.publishBatch({ db, io, recipientIds: ['one', 'one', 'actor', 'two'],
    actorId: 'actor', kind: 'PROJECTION_START', sourcePrefix: 'projection:p1',
    title: 'Projeção', body: 'Começou', href: '/index.html' });
  assert.deepEqual(batch.map(item => item.recipientId), ['one', 'two']);
  assert.equal(batch[0].sourceKey, 'projection:p1:one');
  assert.equal(emitted.length, 3);
});

test('links externos e endpoints de push locais são recusados', () => {
  assert.equal(notifications.safeHref('https://example.com'), '/notifications.html');
  assert.equal(notifications.safeHref('//example.com'), '/notifications.html');
  assert.equal(notifications.safeHref('/perfil.html?id=abc'), '/perfil.html?id=abc');
  assert.equal(notifications.validEndpoint('https://127.0.0.1/push'), false);
  assert.equal(notifications.validEndpoint('http://fcm.googleapis.com/push'), false);
  assert.equal(notifications.validEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
});

test('Web Push remove inscrições expiradas e mantém as demais', async () => {
  if (!notifications.pushAvailable) return;
  const removed = [];
  const db = { pushSubscription: {
    findMany: async () => [
      { id: 'expired', endpoint: 'https://fcm.googleapis.com/fcm/send/expired', p256dh: 'a', auth: 'b' },
      { id: 'valid', endpoint: 'https://fcm.googleapis.com/fcm/send/valid', p256dh: 'c', auth: 'd' },
    ],
    deleteMany: async ({ where }) => { removed.push(where); },
  } };
  const sent = [];
  const sender = { sendNotification: async (subscription, payload) => {
    sent.push([subscription.endpoint, JSON.parse(payload)]);
    if (subscription.endpoint.endsWith('/expired')) throw { statusCode: 410 };
  } };
  await notifications.sendPush({ id: 'n1', recipientId: 'person', title: 'Aviso', body: 'Mensagem',
    href: '/notifications.html', category: 'CHAT' }, db, sender);
  assert.equal(sent.length, 2);
  assert.equal(sent[1][1].href, '/notifications.html');
  assert.deepEqual(removed, [{ id: 'expired', userId: 'person' }]);
});
