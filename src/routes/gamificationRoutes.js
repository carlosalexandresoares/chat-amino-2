const express = require('express');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const gamification = require('../services/gamification');

const router = express.Router();
router.use(auth);

function fail(res, error) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.code === 'P2002') return res.status(409).json({ message: 'Esta operação já foi concluída.' });
  console.error('Erro na gamificação:', error);
  return res.status(500).json({ message: 'Não foi possível concluir a ação.' });
}

router.get('/overview', async (req, res) => {
  try { res.json(await gamification.overview(req.userId, req.app.get('io'))); }
  catch (error) { fail(res, error); }
});

router.get('/users/:id/showcase', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) return res.status(404).json({ message: 'Perfil não encontrado.' });
    if (req.userId === user.id) await gamification.syncAchievements(user.id, req.app.get('io'));
    res.json(await gamification.showcase(user.id));
  } catch (error) { fail(res, error); }
});

router.post('/missions/:id/claim', async (req, res) => {
  try { res.json(await gamification.claimMission(req.userId, req.params.id)); }
  catch (error) { fail(res, error); }
});
router.post('/achievements/:id/claim', async (req, res) => {
  try {
    await gamification.syncAchievements(req.userId, req.app.get('io'));
    res.json(await gamification.claimAchievement(req.userId, req.params.id));
  } catch (error) { fail(res, error); }
});
router.post('/items/:id/purchase', async (req, res) => {
  try { res.json(await gamification.purchase(req.userId, req.params.id)); }
  catch (error) { fail(res, error); }
});
router.put('/items/:id/equip', async (req, res) => {
  try { res.json(await gamification.equip(req.userId, req.params.id, true)); }
  catch (error) { fail(res, error); }
});
router.delete('/items/:id/equip', async (req, res) => {
  try { res.json(await gamification.equip(req.userId, req.params.id, false)); }
  catch (error) { fail(res, error); }
});

router.get('/ledger', async (req, res) => {
  try {
    const cursor = req.query.cursor;
    if (cursor && (typeof cursor !== 'string' || cursor.length > 100 ||
      !await prisma.coinTransaction.findFirst({ where: { id: cursor, userId: req.userId }, select: { id: true } })))
      return res.status(400).json({ message: 'Cursor inválido.' });
    const rows = await prisma.coinTransaction.findMany({ where: { userId: req.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, amount: true, balanceAfter: true, reason: true, createdAt: true } });
    res.json({ transactions: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null });
  } catch (error) { fail(res, error); }
});

module.exports = router;
