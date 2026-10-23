const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSocketUser } = require('../src/services/socketUser');

test('conexão carrega status de presença após a migração', async () => {
  const calls = [];
  const prisma = { user: { findUnique: async query => {
    calls.push(query);
    return { id: 'one', presenceStatus: 'INVISIBLE' };
  } } };
  assert.deepEqual(await loadSocketUser(prisma, 'one'), { id: 'one', presenceStatus: 'INVISIBLE' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].select.presenceStatus, true);
});

test('conexão mantém o chat disponível se a coluna de presença ainda não existe', async () => {
  const calls = [];
  const prisma = { user: { findUnique: async query => {
    calls.push(query);
    if (calls.length === 1) throw Object.assign(new Error('missing column'), { code: 'P2022' });
    return { id: 'one', username: 'alice' };
  } } };
  assert.deepEqual(await loadSocketUser(prisma, 'one'), {
    id: 'one', username: 'alice', presenceStatus: 'ONLINE',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].select.presenceStatus, undefined);
});

test('conexão propaga falhas que não sejam coluna pendente', async () => {
  const failure = new Error('database offline');
  const prisma = { user: { findUnique: async () => { throw failure; } } };
  await assert.rejects(loadSocketUser(prisma, 'one'), error => error === failure);
});
