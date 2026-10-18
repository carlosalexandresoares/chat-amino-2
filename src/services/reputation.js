const prisma = require('../database/prisma');

const LEVELS = [
  ['Estudante da Academia', 0], ['Ninja Novato', 100], ['Genin', 250],
  ['Genin Experiente', 500], ['Genin de Elite', 900], ['Chunin', 1500],
  ['Chunin Experiente', 2300], ['Chunin de Elite', 3500], ['Jounin Especial', 5000],
  ['Jounin', 7000], ['Jounin de Elite', 10000], ['ANBU', 14000],
  ['Capitão ANBU', 19000], ['Ninja Renegado', 26000], ['Ninja Lendário', 35000],
  ['Sannin Lendário', 47000], ['Kage', 63000], ['Grande Kage', 83000],
  ['Lenda Shinobi', 110000], ['Deus Shinobi', 150000],
];
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function dayKey(date = new Date()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function dayDate(date = new Date()) { return new Date(`${dayKey(date)}T00:00:00.000Z`); }
function dayWindow(date = new Date()) {
  const start = new Date(`${dayKey(date)}T03:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + 86400000) };
}
function previousDay(day) { return new Date(day.getTime() - 86400000).toISOString().slice(0, 10); }
function levelFor(xp) {
  for (let i = LEVELS.length - 1; i >= 0; i--) if (xp >= LEVELS[i][1]) return i + 1;
  return 1;
}
function progress(xp) {
  const level = levelFor(xp), currentXp = LEVELS[level - 1][1];
  const nextXp = level < 20 ? LEVELS[level][1] : null;
  return { level, title: LEVELS[level - 1][0], currentLevelXp: currentXp, nextLevelXp: nextXp,
    xpToNext: nextXp === null ? 0 : Math.max(0, nextXp - xp),
    progressPercent: nextXp === null ? 100 : Math.round((xp - currentXp) * 100 / (nextXp - currentXp)) };
}
function validMessage(text) {
  if (typeof text !== 'string') return false;
  const s = text.trim();
  if (s.length < 3 || /^[/!#.]/.test(s) || /(.)\1{7,}/u.test(s)) return false;
  if (!/[\p{L}\p{N}]/u.test(s)) return false;
  return !/^(.{1,12})\1{2,}$/u.test(s);
}
async function locked(tx, userId) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  return tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, xp: true, level: true, username: true, avatar: true } });
}
async function award(tx, user, amount, reason, sourceKey, now = new Date()) {
  const duplicate = await tx.xpEvent.findUnique({ where: { sourceKey }, select: { id: true } });
  if (duplicate) return { user, gainedXp: 0, previousLevel: user.level, leveledUp: false };
  let granted = amount;
  if (reason === 'MESSAGE_SENT' || reason === 'CHAT_PRESENCE') {
    const total = await tx.xpEvent.aggregate({ where: { userId: user.id, reason, createdAt: { gte: new Date(`${dayKey(now)}T03:00:00.000Z`), lt: new Date(new Date(`${dayKey(now)}T03:00:00.000Z`).getTime() + 86400000) } }, _sum: { amount: true } });
    // The calendar window is Sao Paulo local midnight (UTC-03:00).
    granted = Math.min(amount, Math.max(0, 100 - (total._sum.amount || 0)));
  }
  if (!granted) return { user, gainedXp: 0, previousLevel: user.level, leveledUp: false };
  await tx.xpEvent.create({ data: { userId: user.id, amount: granted, reason, sourceKey, createdAt: now } });
  const updated = await tx.user.update({ where: { id: user.id }, data: { xp: { increment: granted }, level: levelFor(user.xp + granted) }, select: { id: true, xp: true, level: true, username: true, avatar: true } });
  return { user: updated, gainedXp: granted, previousLevel: user.level, leveledUp: updated.level > user.level };
}
async function grant(userId, amount, reason, sourceKey, now = new Date()) {
  return prisma.$transaction(async tx => award(tx, await locked(tx, userId), amount, reason, sourceKey, now));
}
async function claimCheckin(userId, now = new Date(), database = prisma) {
  return database.$transaction(async tx => {
    const user = await locked(tx, userId);
    const day = dayDate(now);
    const existing = await tx.checkin.findUnique({ where: { userId_day: { userId, day } } });
    if (existing) return { claimed: false, streak: existing.streak, reward: existing.reward, user };
    const last = await tx.checkin.findFirst({ where: { userId }, orderBy: { day: 'desc' } });
    const streak = last?.day.toISOString().slice(0, 10) === previousDay(day) ? last.streak + 1 : 1;
    const reward = Math.min(streak, 11);
    await tx.checkin.create({ data: { userId, day, streak, reward } });
    const result = await award(tx, user, reward, 'CHECKIN', `checkin:${userId}:${dayKey(now)}`, now);
    return { ...result, claimed: true, streak, reward };
  });
}
async function checkinStatus(userId, now = new Date()) {
  const last = await prisma.checkin.findFirst({ where: { userId }, orderBy: { day: 'desc' } });
  const today = dayKey(now), lastDay = last?.day.toISOString().slice(0, 10);
  const claimed = lastDay === today;
  const streak = claimed || lastDay === previousDay(dayDate(now)) ? last.streak : 0;
  return { claimed, streak, nextReward: claimed ? Math.min(streak + 1, 11) : Math.min(streak + 1, 11) };
}
async function messageAward(tx, userId, messageId, content, now = new Date()) {
  const user = await locked(tx, userId);
  if (!validMessage(content)) return { user, gainedXp: 0, previousLevel: user.level, leveledUp: false };
  const repeated = await tx.message.findFirst({ where: { userId, id: { not: messageId },
    createdAt: { gte: new Date(now.getTime() - 600000) }, content: { equals: content, mode: 'insensitive' } }, select: { id: true } });
  if (repeated) return { user, gainedXp: 0, previousLevel: user.level, leveledUp: false };
  const activity = await tx.userActivity.findUnique({ where: { userId } });
  const fresh = !activity?.lastRealAt || now - activity.lastRealAt > 180000;
  await tx.userActivity.upsert({ where: { userId },
    create: { userId, lastRealAt: now, activeSince: now },
    update: { lastRealAt: now, ...(fresh ? { activeSince: now, lastPresenceXpAt: null } : {}) } });
  const last = await tx.xpEvent.findFirst({ where: { userId, reason: 'MESSAGE_SENT' }, orderBy: { createdAt: 'desc' } });
  if (last && now - last.createdAt < 30000) return { user, gainedXp: 0, previousLevel: user.level, leveledUp: false, realActivity: true };
  const result = await award(tx, user, 2, 'MESSAGE_SENT', `message:${messageId}`, now);
  return { ...result, realActivity: true };
}
async function presenceAward(userId, now = new Date(), database = prisma) {
  return database.$transaction(async tx => {
    const user = await locked(tx, userId);
    const activity = await tx.userActivity.findUnique({ where: { userId } });
    if (!activity?.lastRealAt || now - activity.lastRealAt > 180000) return null;
    const since = activity.lastPresenceXpAt || activity.activeSince;
    if (now - since < 120000) return null;
    await tx.userActivity.update({ where: { userId }, data: { lastPresenceXpAt: now } });
    return award(tx, user, 1, 'CHAT_PRESENCE', `presence:${userId}:${Math.floor(now.getTime() / 120000)}`, now);
  });
}
module.exports = { LEVELS, dayKey, dayDate, dayWindow, levelFor, progress, validMessage, grant, claimCheckin, checkinStatus, messageAward, presenceAward, locked, award };
