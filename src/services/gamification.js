const prisma = require('../database/prisma');
const reputation = require('./reputation');
const notifications = require('./notifications');

const DAILY_COIN_CAP = 80;
const WEEKLY_COIN_CAP = 250;
const syncRunning = new Map();

function period(now = new Date()) {
  const day = reputation.dayKey(now);
  const monday = new Date(`${day}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const week = monday.toISOString().slice(0, 10);
  const next = new Date(monday); next.setUTCDate(next.getUTCDate() + 7);
  const localWindow = key => new Date(`${key}T03:00:00.000Z`);
  const dayStart = localWindow(day);
  return { day, week, dayStart, dayEnd: new Date(dayStart.getTime() + 86400000),
    weekStart: localWindow(week), weekEnd: localWindow(next.toISOString().slice(0, 10)),
    dayDate: new Date(`${day}T00:00:00.000Z`),
    weekDate: new Date(`${week}T00:00:00.000Z`),
    nextWeekDate: next };
}

async function metrics(userId, db = prisma) {
  const [messages, posts, rooms, longest, likesReceived, hosted, attended, user] = await Promise.all([
    db.xpEvent.count({ where: { userId, reason: 'MESSAGE_SENT' } }),
    db.post.count({ where: { userId, sharedPostId: null } }),
    db.room.count({ where: { ownerId: userId } }),
    db.checkin.findFirst({ where: { userId }, orderBy: { streak: 'desc' }, select: { streak: true } }),
    db.postLike.count({ where: { post: { userId } } }),
    db.liveSession.count({ where: { hostId: userId, status: 'ENDED' } }),
    db.eventParticipant.count({ where: { userId, attendedAt: { not: null } } }),
    db.user.findUnique({ where: { id: userId }, select: { level: true } }),
  ]);
  if (!user) throw new Error('Usuário não encontrado.');
  return { MESSAGES: messages, POSTS: posts, ROOMS: rooms, CHECKIN_STREAK: longest?.streak || 0,
    LIKES_RECEIVED: likesReceived, HOSTED_PROJECTIONS: hosted,
    EVENTS_ATTENDED: attended, LEVEL: user.level };
}

async function syncAchievements(userId, io) {
  if (syncRunning.has(userId)) return syncRunning.get(userId);
  const task = (async () => {
    const [catalog, values] = await Promise.all([prisma.achievement.findMany({ orderBy: { target: 'asc' } }), metrics(userId)]);
    const eligible = catalog.filter(item => (values[item.metric] || 0) >= item.target);
    const created = eligible.length ? await prisma.userAchievement.createManyAndReturn({
      data: eligible.map(item => ({ userId, achievementId: item.id })), skipDuplicates: true,
    }) : [];
    const byId = new Map(catalog.map(item => [item.id, item]));
    for (const unlocked of created) {
      const achievement = byId.get(unlocked.achievementId);
      void notifications.publish({ recipientId: userId, kind: 'ACHIEVEMENT_UNLOCKED',
        sourceKey: `achievement:${userId}:${achievement.id}`, title: 'Conquista desbloqueada',
        body: `${achievement.medal} ${achievement.title}`, href: '/gamification.html', io,
      }).catch(error => console.error('Falha na notificação de conquista:', error));
    }
    return values;
  })().finally(() => syncRunning.delete(userId));
  syncRunning.set(userId, task);
  return task;
}

async function missionProgress(userId, now = new Date(), db = prisma) {
  const p = period(now);
  const [dailyCheckins, weeklyCheckins, dailyMessages, dailyPosts, weeklyPosts, dailyLikes, dailyClaims, weeklyEvents] = await Promise.all([
    db.checkin.count({ where: { userId, day: p.dayDate } }),
    db.checkin.count({ where: { userId, day: { gte: p.weekDate, lt: p.nextWeekDate } } }),
    db.xpEvent.count({ where: { userId, reason: 'MESSAGE_SENT', createdAt: { gte: p.dayStart, lt: p.dayEnd } } }),
    db.post.count({ where: { userId, sharedPostId: null, createdAt: { gte: p.dayStart, lt: p.dayEnd } } }),
    db.post.count({ where: { userId, sharedPostId: null, createdAt: { gte: p.weekStart, lt: p.weekEnd } } }),
    db.postLike.count({ where: { userId, createdAt: { gte: p.dayStart, lt: p.dayEnd } } }),
    db.missionClaim.count({ where: { userId, periodKey: { gte: p.week, lte: p.day },
      mission: { cadence: 'DAILY' } } }),
    db.eventParticipant.count({ where: { userId,
      attendedAt: { gte: p.weekStart, lt: p.weekEnd } } }),
  ]);
  return { period: p, values: {
    DAILY: { CHECKINS: dailyCheckins, MESSAGES: dailyMessages, POSTS: dailyPosts, LIKES_GIVEN: dailyLikes },
    WEEKLY: { CHECKINS: weeklyCheckins, POSTS: weeklyPosts,
      DAILY_CLAIMS: dailyClaims, EVENTS_ATTENDED: weeklyEvents },
  } };
}

async function missionValue(userId, mission, current, db) {
  const daily = mission.cadence === 'DAILY';
  if (mission.metric === 'CHECKINS') return db.checkin.count({ where: { userId,
    day: daily ? current.dayDate : { gte: current.weekDate, lt: current.nextWeekDate } } });
  if (mission.metric === 'MESSAGES') return db.xpEvent.count({ where: { userId, reason: 'MESSAGE_SENT',
    createdAt: { gte: current.dayStart, lt: current.dayEnd } } });
  if (mission.metric === 'POSTS') return db.post.count({ where: { userId, sharedPostId: null,
    createdAt: { gte: daily ? current.dayStart : current.weekStart,
      lt: daily ? current.dayEnd : current.weekEnd } } });
  if (mission.metric === 'LIKES_GIVEN') return db.postLike.count({ where: { userId,
    createdAt: { gte: current.dayStart, lt: current.dayEnd } } });
  if (mission.metric === 'DAILY_CLAIMS') return db.missionClaim.count({ where: { userId,
    periodKey: { gte: current.week, lte: current.day }, mission: { cadence: 'DAILY' } } });
  if (mission.metric === 'EVENTS_ATTENDED') return db.eventParticipant.count({ where: { userId,
    attendedAt: { gte: current.weekStart, lt: current.weekEnd } } });
  return 0;
}

async function overview(userId, io) {
  const values = await syncAchievements(userId, io);
  const { period: current, values: missionValues } = await missionProgress(userId);
  const [user, achievements, unlocked, missions, claims, catalog, inventory, transactions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, coinBalance: true } }),
    prisma.achievement.findMany({ orderBy: [{ target: 'asc' }, { id: 'asc' }] }),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true, unlockedAt: true, coinsClaimedAt: true } }),
    prisma.mission.findMany({ where: { active: true }, orderBy: [{ cadence: 'asc' }, { id: 'asc' }] }),
    prisma.missionClaim.findMany({ where: { userId, periodKey: { in: [current.day, current.week] } },
      select: { missionId: true, periodKey: true, claimedAt: true } }),
    prisma.cosmeticItem.findMany({ where: { active: true }, orderBy: [{ type: 'asc' }, { price: 'asc' }] }),
    prisma.userInventory.findMany({ where: { userId }, select: { itemId: true, equipped: true, acquiredAt: true,
      item: { select: { id: true, type: true, title: true, description: true, rarity: true, cssToken: true, price: true } } } }),
    prisma.coinTransaction.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20, select: { id: true, amount: true, balanceAfter: true, reason: true, createdAt: true } }),
  ]);
  const byAchievement = new Map(unlocked.map(item => [item.achievementId, item]));
  const claimed = new Set(claims.map(item => `${item.missionId}:${item.periodKey}`));
  const owned = new Map(inventory.map(item => [item.itemId, item]));
  return {
    balance: user.coinBalance, day: current.day, week: current.week,
    limits: { daily: DAILY_COIN_CAP, weekly: WEEKLY_COIN_CAP },
    achievements: achievements.map(item => ({ ...item, progress: Math.min(item.target, values[item.metric] || 0),
      unlockedAt: byAchievement.get(item.id)?.unlockedAt || null,
      coinsClaimedAt: byAchievement.get(item.id)?.coinsClaimedAt || null })),
    missions: missions.map(item => { const periodKey = item.cadence === 'DAILY' ? current.day : current.week;
      return { ...item, periodKey, progress: Math.min(item.target, missionValues[item.cadence][item.metric] || 0),
        claimed: claimed.has(`${item.id}:${periodKey}`) }; }),
    catalog: catalog.map(item => ({ ...item, owned: owned.has(item.id), equipped: owned.get(item.id)?.equipped || false })),
    inventory,
    transactions,
  };
}

async function lockedUser(tx, userId) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  return tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, coinBalance: true } });
}

async function credit(tx, user, amount, reason, sourceKey, now = new Date()) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Recompensa inválida.');
  const p = period(now);
  const [daily, weekly] = await Promise.all([
    tx.coinTransaction.aggregate({ where: { userId: user.id, amount: { gt: 0 },
      createdAt: { gte: p.dayStart, lt: p.dayEnd } }, _sum: { amount: true } }),
    tx.coinTransaction.aggregate({ where: { userId: user.id, amount: { gt: 0 },
      createdAt: { gte: p.weekStart, lt: p.weekEnd } }, _sum: { amount: true } }),
  ]);
  if ((daily._sum.amount || 0) + amount > DAILY_COIN_CAP ||
    (weekly._sum.amount || 0) + amount > WEEKLY_COIN_CAP) {
    const error = new Error('Limite de moedas atingido. Resgate a recompensa no próximo período.');
    error.status = 409; throw error;
  }
  const balanceAfter = user.coinBalance + amount;
  await tx.user.update({ where: { id: user.id }, data: { coinBalance: balanceAfter } });
  await tx.coinTransaction.create({ data: { userId: user.id, amount, balanceAfter, reason, sourceKey, createdAt: now } });
  return balanceAfter;
}

async function claimMission(userId, missionId) {
  return prisma.$transaction(async tx => {
    const user = await lockedUser(tx, userId);
    const mission = await tx.mission.findUnique({ where: { id: missionId } });
    if (!mission?.active) { const error = new Error('Missão indisponível.'); error.status = 404; throw error; }
    const current = period();
    const periodKey = mission.cadence === 'DAILY' ? current.day : current.week;
    const key = { userId_missionId_periodKey: { userId, missionId, periodKey } };
    if (await tx.missionClaim.findUnique({ where: key })) {
      const error = new Error('Missão já coletada.'); error.status = 409; throw error;
    }
    if ((await missionValue(userId, mission, current, tx)) < mission.target) {
      const error = new Error('Missão ainda não concluída.'); error.status = 409; throw error;
    }
    const balance = await credit(tx, user, mission.coinReward, 'MISSION',
      `mission:${userId}:${missionId}:${periodKey}`);
    await tx.missionClaim.create({ data: { userId, missionId, periodKey } });
    return { claimed: true, balance };
  }, { maxWait: 10000, timeout: 30000 });
}

async function claimAchievement(userId, achievementId) {
  return prisma.$transaction(async tx => {
    const user = await lockedUser(tx, userId);
    const unlock = await tx.userAchievement.findUnique({ where: {
      userId_achievementId: { userId, achievementId } }, include: { achievement: true } });
    if (!unlock) { const error = new Error('Conquista ainda bloqueada.'); error.status = 404; throw error; }
    if (unlock.coinsClaimedAt) { const error = new Error('Recompensa já coletada.'); error.status = 409; throw error; }
    const balance = unlock.achievement.coinReward > 0 ? await credit(tx, user,
      unlock.achievement.coinReward, 'ACHIEVEMENT', `achievement:${userId}:${achievementId}`) : user.coinBalance;
    await tx.userAchievement.update({ where: { userId_achievementId: { userId, achievementId } },
      data: { coinsClaimedAt: new Date() } });
    return { claimed: true, balance };
  }, { maxWait: 10000, timeout: 30000 });
}

async function purchase(userId, itemId) {
  return prisma.$transaction(async tx => {
    const user = await lockedUser(tx, userId);
    const item = await tx.cosmeticItem.findUnique({ where: { id: itemId } });
    if (!item?.active) { const error = new Error('Item indisponível.'); error.status = 404; throw error; }
    if (await tx.userInventory.findUnique({ where: { userId_itemId: { userId, itemId } } })) {
      const error = new Error('Item já adquirido.'); error.status = 409; throw error;
    }
    if (user.coinBalance < item.price) { const error = new Error('Saldo insuficiente.'); error.status = 409; throw error; }
    const balance = user.coinBalance - item.price;
    await tx.user.update({ where: { id: userId }, data: { coinBalance: balance } });
    await tx.userInventory.create({ data: { userId, itemId } });
    await tx.coinTransaction.create({ data: { userId, amount: -item.price, balanceAfter: balance,
      reason: 'PURCHASE', sourceKey: `purchase:${userId}:${itemId}` } });
    return { purchased: true, balance };
  }, { maxWait: 10000, timeout: 30000 });
}

async function equip(userId, itemId, equipped) {
  return prisma.$transaction(async tx => {
    await lockedUser(tx, userId);
    const owned = await tx.userInventory.findUnique({ where: { userId_itemId: { userId, itemId } },
      include: { item: true } });
    if (!owned) { const error = new Error('Item não adquirido.'); error.status = 404; throw error; }
    if (equipped) await tx.userInventory.updateMany({ where: { userId,
      item: { is: { type: owned.item.type } }, equipped: true }, data: { equipped: false } });
    await tx.userInventory.update({ where: { userId_itemId: { userId, itemId } }, data: { equipped } });
    return { equipped };
  }, { maxWait: 10000, timeout: 30000 });
}

async function showcase(userId) {
  const [achievements, equipped] = await Promise.all([
    prisma.userAchievement.findMany({ where: { userId }, orderBy: { unlockedAt: 'desc' }, take: 3,
      select: { unlockedAt: true, achievement: { select: { id: true, title: true, medal: true } } } }),
    prisma.userInventory.findMany({ where: { userId, equipped: true },
      select: { item: { select: { id: true, type: true, title: true, cssToken: true } } } }),
  ]);
  return { achievements, equipped: equipped.map(entry => entry.item) };
}

module.exports = { DAILY_COIN_CAP, WEEKLY_COIN_CAP, period, metrics, missionProgress, syncAchievements,
  overview, claimMission, claimAchievement, purchase, equip, showcase };
