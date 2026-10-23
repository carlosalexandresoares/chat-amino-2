const express = require('express');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const moderation = require('../services/moderation');
const notifications = require('../services/notifications');

const router = express.Router();
router.use(auth);
const fail = (res, error) => {
  if (!error.status) console.error('Erro de moderação:', error);
  res.status(error.status || 500).json({ message: error.status ? error.message : 'Ação indisponível.' });
};
const page = value => Math.max(1, Math.min(100, Number.parseInt(value, 10) || 1));
const validId = value => typeof value === 'string' && /^[a-z0-9_-]{1,100}$/.test(value);

async function scope(req, roomId) {
  if (roomId) {
    if (!validId(roomId) || !await moderation.moderator(req.userId, roomId))
      throw moderation.problem('Sem permissão nesta comunidade.', 403);
    return { roomId };
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { isSiteAdmin: true } });
  if (!user?.isSiteAdmin) throw moderation.problem('Acesso administrativo necessário.', 403);
  return {};
}

router.post('/reports', async (req, res) => {
  try {
    const report = await moderation.submitReport({ reporterId: req.userId,
      kind: req.body?.kind, targetId: req.body?.targetId, reason: req.body?.reason,
      details: req.body?.details || '' });
    res.status(201).json({ reported: true, id: report.id });
  } catch (error) { fail(res, error); }
});

router.get('/reports', async (req, res) => {
  try {
    const where = await scope(req, req.query.roomId);
    const status = ['OPEN', 'RESOLVED', 'DISMISSED'].includes(req.query.status) ? req.query.status : 'OPEN';
    const current = page(req.query.page);
    const rows = await prisma.moderationReport.findMany({ where: { ...where, status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (current - 1) * 30, take: 31,
      select: { id: true, kind: true, targetId: true, subjectUserId: true, roomId: true, reason: true,
        details: true, evidence: true, status: true, createdAt: true, resolutionNote: true,
        reporter: { select: { username: true } }, room: { select: { name: true } } } });
    res.json({ reports: rows.slice(0, 30), hasMore: rows.length > 30, page: current });
  } catch (error) { fail(res, error); }
});

router.patch('/reports/:id', async (req, res) => {
  try {
    const status = req.body?.status;
    const note = req.body?.note;
    if (!['RESOLVED', 'DISMISSED'].includes(status) || typeof note !== 'string' ||
        note.trim().length < 3 || note.trim().length > 500)
      throw moderation.problem('Informe uma conclusão de 3 a 500 caracteres.');
    const report = await prisma.moderationReport.findUnique({ where: { id: req.params.id },
      select: { id: true, roomId: true, kind: true, targetId: true, status: true } });
    if (!report) throw moderation.problem('Denúncia não encontrada.', 404);
    await scope(req, report.roomId);
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.moderationReport.updateMany({ where: { id: report.id, status: 'OPEN' },
        data: { status, resolutionNote: note.trim(), resolvedById: req.userId, resolvedAt: new Date() } });
      if (!result.count) return false;
      await tx.moderationAction.create({ data: { actorId: req.userId, roomId: report.roomId,
        action: `REPORT_${status}`, targetType: report.kind, targetId: report.targetId,
        reason: note.trim() } });
      return true;
    });
    if (!updated) throw moderation.problem('Esta denúncia já foi concluída.', 409);
    res.json({ status });
  } catch (error) { fail(res, error); }
});

router.get('/actions', async (req, res) => {
  try {
    const where = await scope(req, req.query.roomId);
    const current = page(req.query.page);
    const rows = await prisma.moderationAction.findMany({ where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (current - 1) * 30, take: 31,
      select: { id: true, action: true, targetType: true, targetId: true, reason: true,
        createdAt: true, roomId: true, actor: { select: { username: true } },
        targetUser: { select: { username: true } } } });
    res.json({ actions: rows.slice(0, 30), hasMore: rows.length > 30, page: current });
  } catch (error) { fail(res, error); }
});

router.get('/rooms/:roomId/sanctions', async (req, res) => {
  try {
    await scope(req, req.params.roomId);
    const sanctions = await prisma.communitySanction.findMany({ where: { roomId: req.params.roomId,
      revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { expiresAt: 'asc' }, take: 100,
      select: { id: true, type: true, reason: true, expiresAt: true,
        user: { select: { id: true, username: true } } } });
    res.json({ sanctions });
  } catch (error) { fail(res, error); }
});

router.post('/rooms/:roomId/actions', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    await scope(req, roomId);
    const action = req.body?.action;
    const targetUserId = req.body?.targetUserId;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!['WARN', 'MUTE', 'SUSPEND', 'REVOKE_MUTE', 'REVOKE_SUSPEND', 'DELETE_MESSAGE', 'DELETE_POST'].includes(action) ||
        !validId(targetUserId) || reason.length < 3 || reason.length > 500 ||
        !await moderation.canModerateUser(req.userId, targetUserId, roomId))
      throw moderation.problem('Ação não autorizada ou motivo inválido.', 403);
    const duration = Number(req.body?.durationMinutes);
    if (['MUTE', 'SUSPEND'].includes(action) && (!Number.isInteger(duration) || duration < 5 || duration > 10080))
      throw moderation.problem('Duração deve ser entre 5 minutos e 7 dias.');
    let targetId = targetUserId;
    if (['DELETE_MESSAGE', 'DELETE_POST'].includes(action)) {
      targetId = req.body?.targetId;
      if (!validId(targetId)) throw moderation.problem('Conteúdo inválido.');
      const item = action === 'DELETE_MESSAGE' ? await prisma.message.findFirst({
        where: { id: targetId, roomId, userId: targetUserId, deletedAt: null }, select: { id: true } }) :
        await prisma.post.findFirst({ where: { id: targetId, roomId, userId: targetUserId }, select: { id: true } });
      if (!item) throw moderation.problem('Conteúdo indisponível.', 404);
    }
    await prisma.$transaction(async tx => {
      if (action === 'MUTE' || action === 'SUSPEND') await tx.communitySanction.create({ data: {
        roomId, userId: targetUserId, actorId: req.userId, type: action, reason,
        expiresAt: new Date(Date.now() + duration * 60000) } });
      if (action.startsWith('REVOKE_')) {
        const result = await tx.communitySanction.updateMany({ where: { roomId, userId: targetUserId,
          type: action.slice(7), revokedAt: null, expiresAt: { gt: new Date() } },
          data: { revokedAt: new Date() } });
        if (!result.count) throw moderation.problem('Não há restrição ativa.', 404);
      }
      if (action === 'DELETE_MESSAGE') {
        await tx.message.update({ where: { id: targetId }, data: { deletedAt: new Date(), content: '', mediaId: null } });
        await tx.pinnedMessage.deleteMany({ where: { messageId: targetId } });
      }
      if (action === 'DELETE_POST') await tx.post.delete({ where: { id: targetId } });
      await tx.moderationAction.create({ data: { roomId, actorId: req.userId, targetUserId,
        action, targetType: action === 'DELETE_MESSAGE' ? 'MESSAGE' : action === 'DELETE_POST' ? 'POST' : 'USER',
        targetId, reason } });
    });
    const io = req.app.get('io');
    if (action === 'DELETE_MESSAGE') {
      io.to(roomId).emit('chat-message-deleted', { id: targetId });
      io.to(roomId).emit('room-pins-updated', { roomId });
    }
    if (action === 'DELETE_POST') io.to(roomId).emit('moderation:post-removed', { postId: targetId });
    if (action === 'MUTE' || action === 'SUSPEND') req.app.get('removeVoiceUser')?.(roomId, targetUserId);
    if (action === 'SUSPEND') {
      for (const socket of io.sockets.sockets.values()) if (socket.user?.id === targetUserId && socket.rooms.has(roomId)) {
        socket.emit('room-removed', { roomId, message: 'Sua participação foi suspensa temporariamente.' });
        socket.leave(roomId);
      }
    }
    if (['WARN', 'MUTE', 'SUSPEND'].includes(action)) {
      void notifications.publish({ recipientId: targetUserId, actorId: req.userId,
        kind: 'ADMIN_WARNING', sourceKey: `moderation:${roomId}:${targetUserId}:${Date.now()}`,
        title: action === 'WARN' ? 'Advertência da comunidade' : 'Restrição na comunidade',
        body: reason.slice(0, 240), href: `/index.html?sala=${encodeURIComponent(roomId)}`, io })
        .catch(error => console.error('Falha ao notificar moderação:', error));
    }
    res.json({ applied: true });
  } catch (error) { fail(res, error); }
});

module.exports = router;
