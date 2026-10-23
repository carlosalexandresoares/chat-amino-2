const express = require('express');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const { requireSiteAdmin } = require('../middleware/siteAdmin');
const media = require('../services/chatMedia');

const router = express.Router();
router.use(auth, requireSiteAdmin);

function pageNumber(value) {
  return Math.max(1, Math.min(500, Number.parseInt(value, 10) || 1));
}

router.get('/users', async (req, res) => {
  try {
    const page = pageNumber(req.query.page);
    const search = String(req.query.search || '').trim().slice(0, 80);
    const where = search ? { OR: [
      { username: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ] } : {};
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20, take: 20, select: {
          id: true, username: true, email: true, avatar: true, level: true,
          isSiteAdmin: true, createdAt: true, _count: { select: { ownedRooms: true } },
        } }),
      prisma.user.count({ where }),
    ]);
    res.json({ users: users.map(({ _count, ...user }) => ({ ...user, ownedRooms: _count.ownedRooms })), total, page, hasMore: page * 20 < total });
  } catch (error) {
    console.error('Erro ao listar usuários para administração:', error);
    res.status(500).json({ message: 'Não foi possível listar os perfis.' });
  }
});

router.get('/rooms', async (req, res) => {
  try {
    const page = pageNumber(req.query.page);
    const search = String(req.query.search || '').trim().slice(0, 80);
    const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
    const [rooms, total] = await Promise.all([
      prisma.room.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20, take: 20, select: {
          id: true, name: true, owner: { select: { username: true } },
          createdAt: true, _count: { select: { members: true, messages: true } },
        } }),
      prisma.room.count({ where }),
    ]);
    res.json({ rooms: rooms.map(({ _count, ...room }) => ({ ...room, membersCount: _count.members, messagesCount: _count.messages })), total, page, hasMore: page * 20 < total });
  } catch (error) {
    console.error('Erro ao listar chats para administração:', error);
    res.status(500).json({ message: 'Não foi possível listar os chats.' });
  }
});

router.delete('/rooms/:id', async (req, res) => {
  if (req.params.id === 'geral') return res.status(403).json({ message: 'A sala Geral é permanente.' });
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!room) return res.status(404).json({ message: 'Chat não encontrado.' });
    await req.app.get('endLiveSession')(room.id);
    const deleted = await prisma.$transaction(async tx => {
      const result = await tx.room.deleteMany({ where: { id: room.id } });
      if (result.count) await tx.moderationAction.create({ data: { actorId: req.userId,
        action: 'DELETE_ROOM', targetType: 'ROOM', targetId: room.id,
        reason: 'Excluído pela administração geral.' } });
      return result;
    });
    if (!deleted.count) return res.status(404).json({ message: 'Chat não encontrado.' });
    const io = req.app.get('io');
    io.to(room.id).emit('room-removed', { roomId: room.id, message: 'Este chat foi excluído pela administração.' });
    for (const socket of io.sockets.sockets.values()) if (socket.rooms.has(room.id)) socket.leave(room.id);
    res.json({ deleted: true });
  } catch (error) {
    console.error('Erro ao excluir chat:', error);
    res.status(500).json({ message: 'Não foi possível excluir o chat.' });
  }
});

router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.userId) return res.status(403).json({ message: 'Você não pode excluir sua própria conta administradora.' });
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, isSiteAdmin: true } });
    if (!target) return res.status(404).json({ message: 'Perfil não encontrado.' });
    if (target.isSiteAdmin) return res.status(403).json({ message: 'Outra conta administradora não pode ser excluída por aqui.' });

    const hostedLives = await prisma.liveSession.findMany({ where: { hostId: target.id, status: 'ACTIVE' }, select: { roomId: true } });
    for (const live of hostedLives) await req.app.get('endLiveSession')(live.roomId);
    const assetKeys = await prisma.chatAsset.findMany({ where: { ownerId: target.id }, select: { key: true } });
    const memberships = await prisma.roomMember.findMany({ where: { userId: target.id }, select: { roomId: true } });

    await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw`SELECT "id", "isSiteAdmin" FROM "User" WHERE "id" = ${target.id} FOR UPDATE`;
      if (!locked.length || locked[0].isSiteAdmin) throw new Error('ADMIN_TARGET_CHANGED');
      const rooms = await tx.room.findMany({ where: { ownerId: target.id }, select: { id: true } });
      for (const room of rooms) {
        await tx.roomMember.upsert({ where: { userId_roomId: { userId: req.userId, roomId: room.id } },
          create: { userId: req.userId, roomId: room.id, role: 'OWNER' }, update: { role: 'OWNER' } });
        await tx.room.update({ where: { id: room.id }, data: { ownerId: req.userId } });
      }
      await tx.user.delete({ where: { id: target.id } });
      await tx.moderationAction.create({ data: { actorId: req.userId, action: 'DELETE_USER',
        targetType: 'USER', targetId: target.id, reason: 'Excluído pela administração geral.' } });
    }, { maxWait: 10000, timeout: 60000 });

    const io = req.app.get('io');
    for (const socket of io.sockets.sockets.values()) if (socket.user?.id === target.id) {
      socket.emit('account-deleted', { message: 'Sua conta foi excluída pela administração.' });
      socket.disconnect(true);
    }
    for (const { roomId } of memberships) {
      const membersCount = await prisma.roomMember.count({ where: { roomId } });
      io.to(roomId).emit('room-members-count', { roomId, membersCount });
    }
    const removedAssets = await Promise.allSettled(assetKeys.map(({ key }) => media.remove(key)));
    for (const result of removedAssets) if (result.status === 'rejected') console.error('Falha ao remover mídia de perfil excluído:', result.reason);
    res.json({ deleted: true });
  } catch (error) {
    if (error.message === 'ADMIN_TARGET_CHANGED') return res.status(409).json({ message: 'O perfil mudou. Atualize a lista.' });
    console.error('Erro ao excluir perfil:', error);
    res.status(500).json({ message: 'Não foi possível excluir o perfil.' });
  }
});

module.exports = router;
