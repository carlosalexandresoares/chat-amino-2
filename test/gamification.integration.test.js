require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../src/database/prisma');
const reputation = require('../src/services/reputation');

test('gamificação: conquistas, missões, carteira, compras concorrentes e cosméticos', {
  skip: process.env.RUN_GAMIFICATION_LIVE_TESTS !== '1' && 'Defina RUN_GAMIFICATION_LIVE_TESTS=1 com servidor local e banco migrado',
  timeout: 240000,
}, async () => {
  const base = process.env.GAMIFICATION_LIVE_URL || 'http://localhost:3000';
  const tag = randomUUID();
  const users = [];
  let roomId;
  const token = user => jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
  const call = (user, route, method = 'GET', body) => fetch(`${base}${route}`, { method,
    headers: { Authorization: `Bearer ${token(user)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = async response => { const data = await response.json();
    assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`); return data; };
  try {
    for (const name of ['player', 'other']) users.push(await prisma.user.create({ data: {
      username: `game-${name}-${tag}`, email: `game-${name}-${tag}@test.invalid`, password: 'test',
    } }));
    const [player, other] = users;
    const initial = await json(await call(player, '/api/gamification/overview'));
    assert.equal(initial.balance, 0);
    assert.ok(initial.achievements.some(item => item.id === 'first_post' && !item.unlockedAt));
    assert.equal((await call(player, '/api/gamification/achievements/first_post/claim', 'POST')).status, 404);
    assert.equal((await call(player, '/api/gamification/items/frame-amethyst/purchase', 'POST')).status, 409);
    await json(await call(player, '/api/posts', 'POST', { content: 'Minha primeira publicação válida' }));
    const afterPost = await json(await call(player, '/api/gamification/overview'));
    assert.ok(afterPost.achievements.some(item => item.id === 'first_post' && item.unlockedAt));
    assert.equal((await json(await call(player, '/api/gamification/achievements/first_post/claim', 'POST'))).balance, 5);
    assert.equal((await call(player, '/api/gamification/achievements/first_post/claim', 'POST')).status, 409);
    const claims = await Promise.all([1, 2].map(() => call(player, '/api/gamification/missions/daily_post/claim', 'POST')));
    assert.deepEqual(claims.map(response => response.status).sort(), [200, 409]);
    assert.equal((await json(await call(player, '/api/gamification/missions/weekly_post/claim', 'POST'))).balance, 35);
    const foreignPost = await json(await call(other, '/api/posts', 'POST', { content: 'Post para curtida' }));
    assert.equal((await call(player, `/api/posts/${foreignPost.post.id}/like`, 'POST')).status, 200);
    assert.equal((await json(await call(player, '/api/gamification/missions/daily_like/claim', 'POST'))).balance, 40);
    assert.equal((await call(player, '/api/reputation/checkin', 'POST')).status, 200);
    assert.equal((await json(await call(player, '/api/gamification/missions/daily_checkin/claim', 'POST'))).balance, 45);
    assert.equal((await call(player, '/api/gamification/items/title-explorer/purchase', 'POST')).status, 200);
    assert.equal((await call(player, '/api/gamification/items/title-explorer/purchase', 'POST')).status, 409);
    const purchases = await Promise.all(['frame-amethyst', 'frame-ember'].map(id =>
      call(player, `/api/gamification/items/${id}/purchase`, 'POST')));
    assert.deepEqual(purchases.map(response => response.status).sort(), [200, 409]);
    const boughtFrame = purchases[0].status === 200 ? 'frame-amethyst' : 'frame-ember';
    assert.equal((await call(player, `/api/gamification/items/${boughtFrame}/equip`, 'PUT')).status, 200);
    assert.equal((await call(player, '/api/gamification/items/title-explorer/equip', 'PUT')).status, 200);
    assert.equal((await call(other, `/api/gamification/items/${boughtFrame}/equip`, 'PUT')).status, 404);
    const showcase = await json(await call(other, `/api/gamification/users/${player.id}/showcase`));
    assert.deepEqual(new Set(showcase.equipped.map(item => item.id)), new Set([boughtFrame, 'title-explorer']));
    const afterPurchase = await json(await call(player, '/api/gamification/overview'));
    assert.equal(afterPurchase.balance, 5);
    assert.equal(afterPurchase.inventory.length, 2);
    const ledger = await json(await call(player, '/api/gamification/ledger'));
    assert.equal(ledger.transactions.reduce((sum, item) => sum + item.amount, 0), 5);
    assert.equal((await call(other, `/api/gamification/ledger?cursor=${ledger.transactions[0].id}`)).status, 400);
    await prisma.user.update({ where: { id: player.id }, data: { xp: 7000, level: 10 } });
    await prisma.checkin.update({ where: { userId_day: { userId: player.id, day: reputation.dayDate() } }, data: { streak: 7 } });
    const earned = await json(await call(player, '/api/gamification/overview'));
    assert.ok(earned.achievements.some(item => item.id === 'level_10' && item.unlockedAt));
    assert.ok(earned.achievements.some(item => item.id === 'checkin_7' && item.unlockedAt));
    assert.equal((await json(await call(player, '/api/gamification/achievements/level_10/claim', 'POST'))).balance, 25);
    assert.equal((await json(await call(player, '/api/gamification/achievements/checkin_7/claim', 'POST'))).balance, 35);
    await prisma.xpEvent.create({ data: { userId: player.id, amount: 2, reason: 'MESSAGE_SENT', sourceKey: `game-message:${tag}` } });
    assert.equal((await json(await call(player, '/api/gamification/missions/daily_message/claim', 'POST'))).balance, 40);
    const room = await json(await call(player, '/api/rooms', 'POST', { name: `Jornada ${tag.slice(0, 8)}` }));
    roomId = room.room.id;
    assert.ok((await json(await call(player, '/api/gamification/overview'))).achievements
      .some(item => item.id === 'first_community' && item.unlockedAt));
    assert.equal((await call(player, '/api/gamification/achievements/first_community/claim', 'POST')).status, 409);
    assert.equal((await prisma.userAchievement.findUnique({ where: {
      userId_achievementId: { userId: player.id, achievementId: 'first_community' } } })).coinsClaimedAt, null);
    const total = await prisma.coinTransaction.aggregate({ where: { userId: player.id }, _sum: { amount: true } });
    assert.equal(total._sum.amount, (await prisma.user.findUnique({ where: { id: player.id } })).coinBalance);
    assert.equal((await call(player, `/api/gamification/items/${boughtFrame}/equip`, 'DELETE')).status, 200);
    assert.ok(!(await json(await call(player, `/api/gamification/users/${player.id}/showcase`))).equipped
      .some(item => item.id === boughtFrame));
  } finally {
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    for (const user of users.reverse()) await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
