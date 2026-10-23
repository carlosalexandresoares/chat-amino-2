const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const antiSpam = require('../src/services/antiSpam');

test('antispam limita repetição e volume sem bloquear conversa comum', () => {
  const user = randomUUID();
  const room = randomUUID();
  const start = Date.now();
  for (let index = 0; index < 3; index++)
    assert.equal(antiSpam.allowMessage(user, room, '  Olá   pessoal ', start + index).allowed, true);
  assert.equal(antiSpam.allowMessage(user, room, 'olá pessoal', start + 4).allowed, false);
  for (let index = 0; index < 17; index++)
    assert.equal(antiSpam.allowMessage(user, room, `Mensagem diferente ${index}`, start + index + 10).allowed, true);
  assert.equal(antiSpam.allowMessage(user, room, 'Mais uma', start + 30).allowed, false);
  assert.equal(antiSpam.allowMessage(user, room, 'Voltei', start + 90001).allowed, true);
});

test('antispam identifica links obfuscados e permite endereços diretos', () => {
  assert.equal(antiSpam.suspiciousLink('https://www.youtube.com/watch?v=abc'), false);
  assert.equal(antiSpam.suspiciousLink('https://user:pass@example.com/'), true);
  assert.equal(antiSpam.suspiciousLink('http://192.168.1.1/login'), true);
  assert.equal(antiSpam.suspiciousLink('https://bit.ly/abc'), true);
});
