const test = require('node:test');
const assert = require('node:assert/strict');
const projection = require('../src/services/projectionRep');

test('a coleta ativa exige ciclo de 25 REP e a final recolhe o saldo', () => {
  assert.equal(projection.collectionAmount(24, 0, 'ACTIVE'), 0);
  assert.equal(projection.collectionAmount(25, 0, 'ACTIVE'), 25);
  assert.equal(projection.collectionAmount(49, 0, 'ACTIVE'), 25);
  assert.equal(projection.collectionAmount(49, 0, 'ENDED'), 49);
});

test('o host respeita 250 REP diários em acúmulo e coleta', () => {
  assert.deepEqual(projection.hostAccrual(60, 0, 249), { earned: 1, carriedSeconds: 0 });
  assert.deepEqual(projection.hostAccrual(60, 0, 250), { earned: 0, carriedSeconds: 0 });
  assert.equal(projection.collectionAmount(100, 230, 'ENDED'), 20);
  assert.equal(projection.collectionAmount(100, 250, 'ENDED'), 0);
});

test('o participante recebe um ponto por cinco minutos e respeita os dois limites', () => {
  assert.deepEqual(projection.viewerAccrual(299, 0, 0, 0), { earned: 0, carriedSeconds: 299 });
  assert.deepEqual(projection.viewerAccrual(1, 299, 0, 0), { earned: 1, carriedSeconds: 0 });
  assert.deepEqual(projection.viewerAccrual(600, 0, 29, 99), { earned: 1, carriedSeconds: 0 });
  assert.equal(projection.viewerAccrual(300, 0, 30, 0).earned, 0);
  assert.equal(projection.viewerAccrual(300, 0, 0, 100).earned, 0);
});

test('abas e reconexões contam cada usuário apenas uma vez e excluem o host', () => {
  const roomId = 'sala';
  const socket = (userId, inRoom = true) => ({ user: { id: userId }, rooms: new Set(inRoom ? [roomId] : []) });
  const sockets = new Map([
    ['h', socket('host')], ['a1', socket('viewer-a')], ['a2', socket('viewer-a')],
    ['b', socket('viewer-b')], ['elsewhere', socket('viewer-c', false)],
  ]);
  assert.deepEqual(projection.distinctViewerIds(sockets, roomId, 'host'), ['viewer-a', 'viewer-b']);
  sockets.delete('a1');
  assert.equal(projection.distinctViewerIds(sockets, roomId, 'host').length, 2);
});
