const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/database/prisma');
const { updateProfile } = require('../src/controllers/authController');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('edição do nome valida tamanho, duplicidade e atualiza sessões conectadas', async () => {
  const originalFindFirst = prisma.user.findFirst;
  const originalTransaction = prisma.$transaction;
  const socket = { user: { id: 'user-1', username: 'Antigo', avatar: null } };
  let saved;
  let duplicate = false;
  let findCalls = 0;
  prisma.user.findFirst = async query => {
    findCalls++;
    assert.deepEqual(query.where, {
      id: { not: 'user-1' }, username: { equals: 'Novo Nome', mode: 'insensitive' },
    });
    return duplicate ? { id: 'user-2' } : null;
  };
  prisma.$transaction = async callback => callback({
    user: { update: async query => {
      saved = query.data;
      return { id: 'user-1', username: query.data.username, avatar: null };
    } },
    userImage: { upsert: async () => {}, deleteMany: async () => {} },
  });
  const request = username => ({ userId: 'user-1', body: { username },
    app: { get: key => key === 'io' ? { sockets: { sockets: new Map([['socket-1', socket]]) } } : null } });

  try {
    const invalid = response();
    await updateProfile(request(' x '), invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(findCalls, 0);

    duplicate = true;
    const conflict = response();
    await updateProfile(request(' Novo Nome '), conflict);
    assert.equal(conflict.statusCode, 409);
    assert.equal(saved, undefined);

    duplicate = false;
    const updated = response();
    await updateProfile(request(' Novo Nome '), updated);
    assert.equal(updated.statusCode, 200);
    assert.equal(saved.username, 'Novo Nome');
    assert.equal(updated.body.user.username, 'Novo Nome');
    assert.equal(socket.user.username, 'Novo Nome');
  } finally {
    prisma.user.findFirst = originalFindFirst;
    prisma.$transaction = originalTransaction;
  }
});
