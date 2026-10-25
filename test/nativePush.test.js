const test = require('node:test');
const assert = require('node:assert/strict');
const { validToken, sendNativePush } = require('../src/services/nativePush');

test('tokens nativos inválidos são recusados antes do registro', () => {
  assert.equal(validToken('ios', 'not-a-token'), false);
  assert.equal(validToken('android', 'short'), false);
  assert.equal(validToken('ios', 'a'.repeat(64)), true);
  assert.equal(validToken('android', 'a'.repeat(80)), true);
});

test('push nativo remove token expirado e mantém dispositivos válidos', async () => {
  const deleted = [];
  const sent = [];
  const db = { nativePushDevice: {
    findMany: async () => [
      { id: 'old', platform: 'android', token: 'a'.repeat(80) },
      { id: 'current', platform: 'ios', token: 'b'.repeat(64) },
    ],
    deleteMany: async ({ where }) => { deleted.push(where.id); },
  } };
  await sendNativePush({ recipientId: 'recipient', title: 'Mensagem', body: 'Nova mensagem',
    href: '/direct.html' }, db, async device => {
    sent.push(device.id);
    if (device.id === 'old') throw Object.assign(new Error('Token expirado'),
      { code: 'messaging/registration-token-not-registered' });
  });
  assert.deepEqual(sent.sort(), ['current', 'old']);
  assert.deepEqual(deleted, ['old']);
});
