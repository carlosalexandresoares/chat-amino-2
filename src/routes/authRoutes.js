const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const multer = require('multer');
const prisma = require('../database/prisma');

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

module.exports = router;
