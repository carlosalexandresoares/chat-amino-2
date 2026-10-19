const express = require('express');
const multer = require('multer');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const chat = require('../services/chatMessages');
const media = require('../services/chatMedia');

const router = express.Router();
router.use(auth);
const upload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: media.MAX_AUDIO_BYTES, files: 1, fields: 8, parts: 10, fieldSize: 200, headerPairs: 50,
} });
const uploadFile = (req, res, next) => upload.single('file')(req, res, error => {
  if (error) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Arquivo grande demais.' : 'Upload inválido.' });
  next();
});
const fail = (res, error, fallback) => {
  if (!error.status) console.error(fallback, error);
  res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
};
const validRoomId = value => typeof value === 'string' && /^[a-z0-9_-]{1,50}$/.test(value);
router.get('/config', (_req, res) => res.json({ maxAudioSeconds: media.MAX_AUDIO_SECONDS, uploadsAvailable: media.configured }));
async function uploadLimit(userId, kind, count, hours) {
  const used = await prisma.chatAsset.count({ where: { ownerId: userId, kind,
    createdAt: { gte: new Date(Date.now() - hours * 3600000) } } });
  if (used >= count) throw media.problem('Limite de uploads atingido. Tente novamente mais tarde.', 429);
}

router.get('/rooms/:roomId/messages', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    if (!validRoomId(roomId) || !await chat.roomAccess(req.userId, roomId)) return res.status(403).json({ message: 'Sem acesso à sala.' });
    const before = req.query.before ? await prisma.message.findFirst({ where: { id: String(req.query.before), roomId }, select: { id: true, createdAt: true } }) : null;
    if (req.query.before && !before) return res.status(400).json({ message: 'Marcador de histórico inválido.' });
    const rows = await prisma.message.findMany({ where: { roomId, ...(before ? { OR: [
      { createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } },
    ] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 41, select: chat.messageSelect });
    res.json({ messages: rows.slice(0, 40).reverse().map(chat.format), hasMore: rows.length > 40 });
  } catch (error) { fail(res, error, 'Não foi possível carregar o histórico.'); }
});

router.get('/messages/:id/context', async (req, res) => {
  try {
    const target = await prisma.message.findUnique({ where: { id: req.params.id }, select: chat.messageSelect });
    if (!target || !await chat.roomAccess(req.userId, target.roomId)) return res.status(404).json({ message: 'Mensagem indisponível.' });
    const before = await prisma.message.findMany({ where: { roomId: target.roomId, OR: [
      { createdAt: { lt: target.createdAt } }, { createdAt: target.createdAt, id: { lt: target.id } },
    ] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10, select: chat.messageSelect });
    const after = await prisma.message.findMany({ where: { roomId: target.roomId, OR: [
      { createdAt: { gt: target.createdAt } }, { createdAt: target.createdAt, id: { gt: target.id } },
    ] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 10, select: chat.messageSelect });
    res.json({ messages: [...before.reverse(), target, ...after].map(chat.format), targetId: target.id });
  } catch (error) { fail(res, error, 'Não foi possível localizar a mensagem.'); }
});

router.delete('/messages/:id', async (req, res) => {
  try {
    const message = await prisma.message.findUnique({ where: { id: req.params.id }, select: { userId: true, roomId: true, type: true, deletedAt: true } });
    if (!message || message.userId !== req.userId) return res.status(403).json({ message: 'Você só pode excluir suas mensagens.' });
    if (!message.deletedAt) {
      await prisma.message.update({ where: { id: req.params.id }, data: { deletedAt: new Date(), content: '',
        ...(message.type === 'AUDIO' ? { mediaId: null } : {}) } });
      req.app.get('io').to(message.roomId).emit('chat-message-deleted', { id: req.params.id });
    }
    res.json({ deleted: true });
  } catch (error) { fail(res, error, 'Não foi possível excluir a mensagem.'); }
});

router.put('/messages/:id/reaction', async (req, res) => {
  try {
    const emoji = req.body?.emoji;
    if (emoji !== null && !['❤️', '😂', '👍', '😮', '😢', '🔥'].includes(emoji)) return res.status(400).json({ message: 'Reação inválida.' });
    const message = await prisma.message.findUnique({ where: { id: req.params.id }, select: { roomId: true, deletedAt: true } });
    if (!message || message.deletedAt || !await chat.roomAccess(req.userId, message.roomId)) return res.status(403).json({ message: 'Sem acesso à mensagem.' });
    if (emoji === null) await prisma.messageReaction.deleteMany({ where: { messageId: req.params.id, userId: req.userId } });
    else await prisma.messageReaction.upsert({ where: { messageId_userId: { messageId: req.params.id, userId: req.userId } },
      create: { messageId: req.params.id, userId: req.userId, emoji }, update: { emoji } });
    const reactions = await prisma.messageReaction.findMany({ where: { messageId: req.params.id }, select: { emoji: true, userId: true } });
    req.app.get('io').to(message.roomId).emit('chat-reactions', { id: req.params.id, reactions });
    res.json({ reactions });
  } catch (error) { fail(res, error, 'Não foi possível reagir.'); }
});

router.post('/audio', uploadFile, async (req, res) => {
  let stored;
  try {
    const roomId = req.body.roomId;
    if (!validRoomId(roomId) || !await chat.roomAccess(req.userId, roomId)) throw media.problem('Sem acesso à sala.', 403);
    await uploadLimit(req.userId, 'AUDIO', 12, 1);
    const prepared = await media.prepareAudio(req.file?.buffer);
    stored = await media.put('AUDIO', req.userId, roomId, prepared);
    const asset = await prisma.chatAsset.create({ data: stored });
    res.status(201).json({ id: asset.id, duration: asset.duration, mimeType: asset.mimeType });
  } catch (error) {
    if (stored) await media.remove(stored.key).catch(console.error);
    fail(res, error, 'Não foi possível enviar o áudio.');
  }
});

router.post('/stickers', uploadFile, async (req, res) => {
  let stored;
  try {
    await uploadLimit(req.userId, 'STICKER', 30, 24);
    const prepared = await media.prepareImage(req.file?.buffer, 'STICKER', { x: req.body.cropX, y: req.body.cropY });
    const packId = req.body.packId || null;
    if (packId && !await prisma.stickerPack.findFirst({ where: { id: packId, ownerId: req.userId } })) throw media.problem('Pacote inválido.');
    const name = String(req.body.name || 'Minha figurinha').trim().slice(0, 50);
    stored = await media.put('STICKER', req.userId, null, prepared);
    const sticker = await prisma.$transaction(async tx => {
      const asset = await tx.chatAsset.create({ data: stored });
      return tx.sticker.create({ data: { name, ownerId: req.userId, assetId: asset.id, packId } });
    });
    res.status(201).json({ sticker });
  } catch (error) {
    if (stored) await media.remove(stored.key).catch(console.error);
    fail(res, error, 'Não foi possível criar a figurinha.');
  }
});

router.get('/stickers', async (req, res) => {
  try {
    const tab = ['all', 'mine', 'favorites', 'recent'].includes(req.query.tab) ? req.query.tab : 'all';
    const page = Math.max(1, Math.min(100, Number(req.query.page) || 1));
    const search = String(req.query.search || '').slice(0, 50);
    let assetIds;
    if (tab === 'recent') {
      const recent = await prisma.message.findMany({ where: { userId: req.userId, type: 'STICKER', mediaId: { not: null } },
        orderBy: { createdAt: 'desc' }, take: 100, select: { mediaId: true } });
      assetIds = [...new Set(recent.map(row => row.mediaId))];
    }
    const stickers = await prisma.sticker.findMany({ where: {
      ...(tab === 'mine' ? { ownerId: req.userId } : {}),
      ...(tab === 'favorites' ? { favorites: { some: { userId: req.userId } } } : {}),
      ...(tab === 'recent' ? { assetId: { in: assetIds } } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(req.query.packId ? { packId: String(req.query.packId) } : {}),
    }, orderBy: { createdAt: 'desc' }, ...(tab === 'recent' ? { take: 100 } : { skip: (page - 1) * 48, take: 49 }),
    select: { id: true, name: true, ownerId: true, assetId: true, packId: true, favorites: { where: { userId: req.userId }, select: { userId: true } } } });
    if (tab === 'recent') stickers.sort((a, b) => assetIds.indexOf(a.assetId) - assetIds.indexOf(b.assetId));
    const items = (tab === 'recent' ? stickers.slice((page - 1) * 48, page * 48) : stickers.slice(0, 48))
      .map(({ favorites, ...item }) => ({ ...item, favorite: favorites.length > 0 }));
    res.json({ stickers: items, hasMore: tab === 'recent' ? stickers.length > page * 48 : stickers.length > 48 });
  } catch (error) { fail(res, error, 'Não foi possível listar figurinhas.'); }
});

router.get('/sticker-packs', async (req, res) => {
  try { res.json({ packs: await prisma.stickerPack.findMany({ where: { ownerId: req.userId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true } }) }); }
  catch (error) { fail(res, error, 'Não foi possível listar pacotes.'); }
});
router.post('/sticker-packs', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2 || name.length > 40) throw media.problem('Informe um nome de 2 a 40 caracteres.');
    const count = await prisma.stickerPack.count({ where: { ownerId: req.userId } });
    if (count >= 20) throw media.problem('Limite de pacotes atingido.', 429);
    const pack = await prisma.stickerPack.create({ data: { name, ownerId: req.userId } });
    res.status(201).json({ pack });
  } catch (error) { fail(res, error, 'Não foi possível criar o pacote.'); }
});
router.put('/stickers/:id/favorite', async (req, res) => {
  try {
    if (!await prisma.sticker.findUnique({ where: { id: req.params.id }, select: { id: true } })) return res.status(404).json({ message: 'Figurinha não encontrada.' });
    const favorite = Boolean(req.body?.favorite);
    if (favorite) await prisma.stickerFavorite.upsert({ where: { userId_stickerId: { userId: req.userId, stickerId: req.params.id } },
      create: { userId: req.userId, stickerId: req.params.id }, update: {} });
    else await prisma.stickerFavorite.deleteMany({ where: { userId: req.userId, stickerId: req.params.id } });
    res.json({ favorite });
  } catch (error) { fail(res, error, 'Não foi possível atualizar favoritos.'); }
});

router.get('/appearance', async (req, res) => {
  try { res.json({ appearance: await prisma.chatAppearance.findUnique({ where: { userId: req.userId } }) }); }
  catch (error) { fail(res, error, 'Não foi possível carregar o plano de fundo.'); }
});
router.put('/appearance', async (req, res) => {
  try {
    const { mode, color, preset, assetId } = req.body || {};
    if (!['DEFAULT', 'COLOR', 'PRESET', 'IMAGE'].includes(mode)) throw media.problem('Tipo de fundo inválido.');
    if (mode === 'COLOR' && !/^#[0-9a-f]{6}$/i.test(color)) throw media.problem('Cor inválida.');
    if (mode === 'PRESET' && !['geometry', 'twilight', 'night', 'minimal'].includes(preset)) throw media.problem('Papel de parede inválido.');
    if (mode === 'IMAGE' && !await prisma.chatAsset.findFirst({ where: { id: assetId, ownerId: req.userId, kind: 'WALLPAPER' } })) throw media.problem('Imagem não encontrada.');
    const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));
    const data = { mode, color: mode === 'COLOR' ? color : null, preset: mode === 'PRESET' ? preset : null,
      assetId: mode === 'IMAGE' ? assetId : null, positionX: clamp(req.body.positionX ?? 50),
      positionY: clamp(req.body.positionY ?? 50), darkness: clamp(req.body.darkness), overlay: clamp(req.body.overlay) };
    const appearance = await prisma.chatAppearance.upsert({ where: { userId: req.userId }, create: { userId: req.userId, ...data }, update: data });
    res.json({ appearance });
  } catch (error) { fail(res, error, 'Não foi possível salvar o plano de fundo.'); }
});
router.post('/wallpaper', uploadFile, async (req, res) => {
  let stored;
  try {
    await uploadLimit(req.userId, 'WALLPAPER', 10, 24);
    const prepared = await media.prepareImage(req.file?.buffer, 'WALLPAPER');
    stored = await media.put('WALLPAPER', req.userId, null, prepared);
    const asset = await prisma.chatAsset.create({ data: stored });
    res.status(201).json({ id: asset.id });
  } catch (error) {
    if (stored) await media.remove(stored.key).catch(console.error);
    fail(res, error, 'Não foi possível enviar o wallpaper.');
  }
});

router.get('/media/:id', async (req, res) => {
  try {
    const asset = await prisma.chatAsset.findUnique({ where: { id: req.params.id }, select: {
      key: true, kind: true, mimeType: true, ownerId: true, roomId: true,
      messages: { where: { deletedAt: null }, take: 1, select: { id: true } },
    } });
    if (!asset) return res.status(404).end();
    const allowed = asset.kind === 'STICKER' ||
      (asset.kind === 'WALLPAPER' && asset.ownerId === req.userId) ||
      (asset.kind === 'AUDIO' && await chat.roomAccess(req.userId, asset.roomId) &&
        (asset.ownerId === req.userId || asset.messages.length > 0));
    if (!allowed) return res.status(403).end();
    const data = await media.get(asset.key);
    res.set({ 'Content-Type': asset.mimeType, 'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch (error) { fail(res, error, 'Não foi possível carregar o arquivo.'); }
});

module.exports = router;
