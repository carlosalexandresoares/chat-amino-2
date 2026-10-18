const express = require('express');
const auth = require('../middleware/authMiddleware');
const prisma = require('../database/prisma');
const projection = require('../services/projectionRep');
const { notify } = require('./reputationRoutes');
const router = express.Router();
router.use(auth);

router.get('/mine', async (req, res) => {
  try {
    const page = Math.max(1, Math.min(100, Number.parseInt(req.query.page, 10) || 1));
    const lives = await prisma.liveSession.findMany({ where: { hostId: req.userId },
      orderBy: { startedAt: 'desc' }, skip: (page - 1) * 20, take: 21,
      select: { id: true, roomName: true, startedAt: true, endedAt: true, status: true,
        hostRepAccrued: true, hostRepCollected: true, room: { select: { name: true } } } });
    res.json({ page, hasMore: lives.length > 20, projections: lives.slice(0, 20).map(live => ({
      id: live.id, roomName: live.roomName || live.room.name, startedAt: live.startedAt,
      endedAt: live.endedAt, status: live.status,
      pending: live.hostRepAccrued - live.hostRepCollected,
    })) });
  } catch (error) { console.error('Erro ao listar projeções:', error); res.status(500).json({ message: 'Não foi possível listar as projeções.' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const report = await projection.report(req.params.id, req.userId);
    if (!report) return res.status(404).json({ message: 'Projeção não encontrada.' });
    res.json({ report });
  } catch (error) { console.error('Erro ao carregar projeção:', error); res.status(500).json({ message: 'Não foi possível carregar o resumo.' }); }
});

router.post('/:id/collect', async (req, res) => {
  try {
    const result = await projection.collectHost(req.params.id, req.userId, req.body?.requestId);
    if (result.xpResult?.gainedXp) notify(req, req.userId, result.xpResult, 'LIVE_HOST');
    for (const socket of req.app.get('io').sockets.sockets.values()) if (socket.user?.id === req.userId) {
      socket.emit('projection-rep', { liveId: req.params.id, hostRep: result.status });
    }
    res.json({ granted: result.granted, duplicate: result.duplicate, hostRep: result.status });
  } catch (error) {
    if (!error.status) console.error('Erro ao coletar REP:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível coletar REP.' });
  }
});

module.exports = router;
