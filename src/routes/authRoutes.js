const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const multer = require('multer');
const prisma = require('../database/prisma');
const bcrypt = require('bcrypt');
const media = require('../services/chatMedia');

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 2 } })
  .fields([{ name: 'avatarFile', maxCount: 1 }, { name: 'bannerFile', maxCount: 1 }]);
function acceptImages(req, res, next) {
  imageUpload(req, res, error => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 5 MB.' : 'Envio de imagem inválido.';
    return res.status(400).json({ message });
  });
}

router.get('/media/:userId/:kind', async (req, res) => {
  if (!['avatar', 'banner'].includes(req.params.kind)) return res.sendStatus(404);
  try {
    const image = await prisma.userImage.findUnique({
      where: { userId_kind: { userId: req.params.userId, kind: req.params.kind } },
      select: { data: true, mimeType: true },
    });
    if (!image) return res.sendStatus(404);
    res.set({ 'Content-Type': image.mimeType, 'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=60' });
    return res.send(Buffer.from(image.data));
  } catch (error) {
    console.error('Erro ao carregar imagem do perfil:', error);
    return res.sendStatus(500);
  }
});

router.post("/register", authController.register);
router.post("/login", authController.login);

router.get(
  "/me",
  authMiddleware,
  authController.me
);

router.patch(
  "/profile",
  authMiddleware,
  acceptImages,
  authController.updateProfile
);

router.patch('/privacy', authMiddleware, async (req, res) => {
  if (!['PUBLIC', 'PRIVATE'].includes(req.body?.profileVisibility))
    return res.status(400).json({ message: 'Visibilidade inválida.' });
  try {
    const user = await prisma.user.update({ where: { id: req.userId },
      data: { profileVisibility: req.body.profileVisibility }, select: { profileVisibility: true } });
    res.json({ profileVisibility: user.profileVisibility });
  } catch (error) { console.error('Erro ao atualizar privacidade:', error);
    res.status(500).json({ message: 'Não foi possível atualizar a privacidade.' }); }
});

router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length > 200)
      return res.status(400).json({ message: 'Informe sua senha.' });
    const user = await prisma.user.findUnique({ where: { id: req.userId },
      select: { id: true, password: true, isSiteAdmin: true, ownedRooms: {
        select: { id: true, members: { where: { role: 'CO_ADMIN' },
          orderBy: { joinedAt: 'asc' }, take: 1, select: { userId: true } } } } } });
    if (!user || !await bcrypt.compare(password, user.password))
      return res.status(403).json({ message: 'Senha incorreta.' });
    if (user.isSiteAdmin) return res.status(403).json({ message: 'Transfira a administração geral antes de excluir esta conta.' });
    const lives = await prisma.liveSession.findMany({ where: { hostId: user.id, status: 'ACTIVE' }, select: { roomId: true } });
    for (const live of lives) await req.app.get('endLiveSession')(live.roomId);
    const keys = await prisma.chatAsset.findMany({ where: { ownerId: user.id }, select: { key: true } });
    await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw`SELECT id, "isSiteAdmin" FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      if (!locked.length || locked[0].isSiteAdmin) throw new Error('ACCOUNT_CHANGED');
      for (const room of user.ownedRooms) {
        const successor = room.members[0]?.userId;
        if (successor) {
          await tx.roomMember.update({ where: { userId_roomId: { userId: successor, roomId: room.id } },
            data: { role: 'OWNER' } });
          await tx.room.update({ where: { id: room.id }, data: { ownerId: successor } });
        } else await tx.room.delete({ where: { id: room.id } });
      }
      await tx.moderationAction.create({ data: { action: 'ACCOUNT_SELF_DELETE', targetType: 'USER',
        targetId: user.id, reason: 'Solicitação confirmada com senha.' } });
      await tx.user.delete({ where: { id: user.id } });
    }, { maxWait: 10000, timeout: 60000 });
    for (const socket of req.app.get('io').sockets.sockets.values()) if (socket.user?.id === user.id) {
      socket.emit('account-deleted', { message: 'Sua conta foi excluída.' }); socket.disconnect(true);
    }
    for (const result of await Promise.allSettled(keys.map(item => media.remove(item.key))))
      if (result.status === 'rejected') console.error('Falha ao remover arquivo da conta excluída:', result.reason);
    res.json({ deleted: true });
  } catch (error) {
    if (error.message === 'ACCOUNT_CHANGED') return res.status(409).json({ message: 'A conta mudou. Tente novamente.' });
    console.error('Erro ao excluir conta:', error);
    res.status(500).json({ message: 'Não foi possível excluir a conta.' });
  }
});

module.exports = router;
