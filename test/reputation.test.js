const test = require('node:test');
const assert = require('node:assert/strict');
const rep = require('../src/services/reputation');

function database() {
  const user = { id: 'u1', username: 'Naruto', avatar: null, xp: 0, level: 1 };
  const events = [], checkins = [];
  let activity = null;
  let tail = Promise.resolve();
  const tx = {
    $queryRaw: async () => [{ id: user.id }],
    user: {
      findUniqueOrThrow: async () => ({ ...user }),
      update: async ({ data }) => { user.xp += data.xp.increment; user.level = data.level; return { ...user }; },
    },
    xpEvent: {
      findUnique: async ({ where }) => events.find(e => e.sourceKey === where.sourceKey) || null,
      findFirst: async ({ where }) => events.filter(e => e.userId === where.userId && e.reason === where.reason).at(-1) || null,
      aggregate: async ({ where }) => ({ _sum: { amount: events.filter(e => e.userId === where.userId && e.reason === where.reason && e.createdAt >= where.createdAt.gte && e.createdAt < where.createdAt.lt).reduce((n, e) => n + e.amount, 0) } }),
      create: async ({ data }) => { events.push(data); return data; },
    },
    checkin: {
      findUnique: async ({ where }) => checkins.find(c => c.userId === where.userId_day.userId && +c.day === +where.userId_day.day) || null,
      findFirst: async ({ where }) => checkins.filter(c => c.userId === where.userId).at(-1) || null,
      create: async ({ data }) => { checkins.push(data); return data; },
    },
    userActivity: {
      findUnique: async () => activity,
      upsert: async ({ create, update }) => { activity = activity ? { ...activity, ...update } : { ...create }; return activity; },
      update: async ({ data }) => { activity = { ...activity, ...data }; return activity; },
    },
    message: { findFirst: async () => null },
  };
  return { user, events, checkins, tx, $transaction(fn) { const run = tail.then(() => fn(tx)); tail = run.catch(() => {}); return run; } };
}

test('vinte níveis com teto e XP permanente', () => {
  assert.equal(rep.LEVELS.length, 20);
  assert.equal(rep.levelFor(99), 1);
  assert.equal(rep.levelFor(16200), 12);
  assert.equal(rep.progress(16200).progressPercent, 44);
  assert.equal(rep.levelFor(200000), 20);
  assert.equal(rep.progress(200000).nextLevelXp, null);
});

test('check-in simultâneo paga uma vez e sequência reinicia após falta', async () => {
  const db = database();
  const day1 = new Date('2026-10-18T15:00:00Z');
  const [a, b] = await Promise.all([rep.claimCheckin('u1', day1, db), rep.claimCheckin('u1', day1, db)]);
  assert.equal([a.claimed, b.claimed].filter(Boolean).length, 1);
  assert.equal(db.user.xp, 1);
  const day2 = await rep.claimCheckin('u1', new Date('2026-10-19T15:00:00Z'), db);
  assert.equal(day2.reward, 2);
  const day4 = await rep.claimCheckin('u1', new Date('2026-10-21T15:00:00Z'), db);
  assert.equal(day4.streak, 1);
  assert.equal(db.user.xp, 4);
});

test('sequência diária limita recompensa em 11 XP', async () => {
  const db = database();
  const start = new Date('2026-10-01T15:00:00Z');
  let last;
  for (let i = 0; i < 13; i++) last = await rep.claimCheckin('u1', new Date(start.getTime() + i * 86400000), db);
  assert.equal(last.streak, 13);
  assert.equal(last.reward, 11);
  assert.equal(db.user.xp, 88);
});

test('ganho idempotente, limites diários e avanço de nível', async () => {
  const db = database();
  const now = new Date('2026-10-18T15:00:00Z');
  const first = await db.$transaction(async tx => rep.award(tx, await rep.locked(tx, 'u1'), 2, 'MESSAGE_SENT', 'message:m1', now));
  const duplicate = await db.$transaction(async tx => rep.award(tx, await rep.locked(tx, 'u1'), 2, 'MESSAGE_SENT', 'message:m1', now));
  assert.equal(first.gainedXp, 2);
  assert.equal(duplicate.gainedXp, 0);
  for (let i = 2; i <= 60; i++) await db.$transaction(async tx => rep.award(tx, await rep.locked(tx, 'u1'), 2, 'MESSAGE_SENT', `message:m${i}`, now));
  assert.equal(db.user.xp, 100);
  assert.equal(db.user.level, 2);
  const presence = await db.$transaction(async tx => rep.award(tx, await rep.locked(tx, 'u1'), 101, 'CHAT_PRESENCE', 'presence:one', now));
  assert.equal(presence.gainedXp, 100);
  assert.equal(db.user.xp, 200);
});

test('um ganho pode avançar vários níveis e XP continua após o nível 20', async () => {
  const db = database();
  const first = await db.$transaction(async tx => rep.award(tx, await rep.locked(tx, 'u1'), 150000, 'ADMIN_TEST', 'test:large'));
  assert.equal(first.previousLevel, 1);
  assert.equal(first.user.level, 20);
  assert.equal(first.leveledUp, true);
  const next = await db.$transaction(async tx => rep.award(tx, await rep.locked(tx, 'u1'), 500, 'ADMIN_TEST', 'test:extra'));
  assert.equal(next.user.xp, 150500);
  assert.equal(next.user.level, 20);
  assert.equal(next.leveledUp, false);
});

test('mensagens exigem 30 segundos entre recompensas', async () => {
  const db = database();
  const now = new Date('2026-10-18T15:00:00Z');
  const a = await db.$transaction(tx => rep.messageAward(tx, 'u1', 'a', 'Olá, pessoal!', now));
  const b = await db.$transaction(tx => rep.messageAward(tx, 'u1', 'b', 'Outra conversa', new Date(now.getTime() + 29000)));
  const c = await db.$transaction(tx => rep.messageAward(tx, 'u1', 'c', 'Terceira conversa', new Date(now.getTime() + 30000)));
  assert.deepEqual([a.gainedXp, b.gainedXp, c.gainedXp], [2, 0, 2]);
});

test('presença exige atividade recente e intervalos de dois minutos', async () => {
  const db = database();
  const start = new Date('2026-10-18T15:00:00Z');
  await db.$transaction(tx => rep.messageAward(tx, 'u1', 'a', 'Começando conversa', start));
  assert.equal(await rep.presenceAward('u1', new Date(start.getTime() + 119000), db), null);
  const earned = await rep.presenceAward('u1', new Date(start.getTime() + 120000), db);
  assert.equal(earned.gainedXp, 1);
  assert.equal(await rep.presenceAward('u1', new Date(start.getTime() + 150000), db), null);
  assert.equal(await rep.presenceAward('u1', new Date(start.getTime() + 181000), db), null);
});

test('filtro de mensagens exclui comandos, emoji e spam simples', () => {
  assert.equal(rep.validMessage('/help'), false);
  assert.equal(rep.validMessage('😀😀😀'), false);
  assert.equal(rep.validMessage('ahahahah'), false);
  assert.equal(rep.validMessage('Olá, pessoal!'), true);
});
