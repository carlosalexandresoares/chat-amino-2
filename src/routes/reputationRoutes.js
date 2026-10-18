const express = require('express');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const rep = require('../services/reputation');
const router = express.Router();
router.use(auth);

function notify(req, userId, result, reason) {
  if (!result?.gainedXp) return;
  const io = req.app.get('io');
  for (const socket of io.sockets.sockets.values()) if (socket.user?.id === userId) {
    socket.user = { ...socket.user, ...result.user };
    socket.emit('xp-updated', { reason, gainedXp: result.gainedXp, xp: result.user.xp, ...rep.progress(result.user.xp) });
    if (result.leveledUp) socket.emit('level-up', { previousLevel: result.previousLevel, xp: result.user.xp, ...rep.progress(result.user.xp) });
  }
}
router.get('/reputation/levels', (_req, res) => res.json({ levels: rep.LEVELS.map(([title, xp], i) => ({ level: i + 1, title, xp })) }));
router.get('/reputation/checkin', async (req, res) => {
  try { res.json(await rep.checkinStatus(req.userId)); }
  catch (e) { console.error(e); res.status(500).json({ message: 'Não foi possível carregar o check-in.' }); }
});
router.post('/reputation/checkin', async (req, res) => {
  try {
    const result = await rep.claimCheckin(req.userId);
    if (result.claimed) notify(req, req.userId, result, 'CHECKIN');
    res.status(result.claimed ? 200 : 409).json({ claimed: result.claimed, streak: result.streak, reward: result.reward, xp: result.user.xp, ...rep.progress(result.user.xp) });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Não foi possível fazer check-in.' }); }
});
router.get('/reputation/ranking', async (req, res) => {
  const period = ['daily', 'weekly', 'monthly', 'all'].includes(req.query.period) ? req.query.period : 'all';
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
  const size = 20, offset = (page - 1) * size;
  try {
    let rows;
    if (period === 'all') rows = await prisma.user.findMany({ orderBy: [{ xp: 'desc' }, { id: 'asc' }], skip: offset, take: size + 1, select: { id: true, username: true, avatar: true, xp: true, level: true } });
    else {
      const today = rep.dayKey();
      const local = new Date(`${today}T00:00:00.000Z`);
      if (period === 'weekly') local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
      if (period === 'monthly') local.setUTCDate(1);
      const since = new Date(local.getTime() + 3 * 3600000);
      rows = await prisma.$queryRaw`SELECT u.id, u.username, u.avatar, u.level, SUM(e.amount)::int AS points FROM "XpEvent" e JOIN "User" u ON u.id = e."userId" WHERE e."createdAt" >= ${since} GROUP BY u.id ORDER BY points DESC, u.id ASC LIMIT ${size + 1} OFFSET ${offset}`;
    }
    res.json({ period, page, hasMore: rows.length > size, users: rows.slice(0, size).map((u, i) => ({ position: offset + i + 1, id: u.id, username: u.username, avatar: u.avatar, level: u.level, title: rep.LEVELS[Math.min(20, Math.max(1, u.level)) - 1][0], points: period === 'all' ? u.xp : u.points })) });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Não foi possível carregar o ranking.' }); }
});
module.exports = { router, notify };
