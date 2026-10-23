const express = require('express');
const prisma = require('../database/prisma');
const auth = require('../middleware/authMiddleware');
const notifications = require('../services/notifications');
const { isSiteAdmin } = require('../middleware/siteAdmin');
const socialFeed = require('../services/socialFeed');
const moderation = require('../services/moderation');

const router = express.Router();
router.use(auth);
const commentSelect = { id: true, postId: true, parentId: true, content: true, createdAt: true,
  user: { select: { id: true, username: true, avatar: true } },
  parent: { select: { user: { select: { username: true } } } } };

router.get('/my-communities', async (req, res) => {
  try {
    const memberships = await prisma.roomMember.findMany({ where: { userId: req.userId },
      orderBy: { joinedAt: 'desc' }, take: 100,
      select: { room: { select: { id: true, name: true } } } });
    res.json({ rooms: memberships.map(item => item.room) });
  } catch (cause) { error(res, cause); }
});

function error(res, cause) {
  if (!cause.status) console.error('Erro no feed social:', cause);
  return res.status(cause.status || 500).json({ message: cause.status ? cause.message : 'Não foi possível concluir a ação.' });
}

router.get('/feed', async (req, res) => {
  try { res.json(await socialFeed.feed(req.userId, req.query.mode || 'forYou', req.query.cursor)); }
  catch (cause) { if (cause.message.includes('inválido')) return res.status(400).json({ message: cause.message }); error(res, cause); }
});

router.get('/posts/:id', async (req, res) => {
  try {
    const post = await prisma.post.findFirst({ where: { id: req.params.id, ...socialFeed.visibleWhere(req.userId) },
      select: socialFeed.publicSelect(req.userId) });
    if (!post) return res.status(404).json({ message: 'Publicação não encontrada.' });
    res.json({ post: socialFeed.serialize(post) });
  } catch (cause) { error(res, cause); }
});

router.get('/posts/:id/comments', async (req, res) => {
  try {
    if (!await socialFeed.visiblePost(req.userId, req.params.id)) return res.status(404).json({ message: 'Publicação não encontrada.' });
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length < 100 ? req.query.cursor : null;
    if (req.query.cursor && !cursor) return res.status(400).json({ message: 'Cursor inválido.' });
    if (cursor && !await prisma.postComment.findFirst({ where: { id: cursor, postId: req.params.id }, select: { id: true } }))
      return res.status(400).json({ message: 'Cursor inválido.' });
    const comments = await prisma.postComment.findMany({ where: { postId: req.params.id,
      user: socialFeed.noBlock(req.userId) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: commentSelect });
    const page = comments.slice(0, 30);
    res.json({ comments: page, nextCursor: comments.length > 30 ? page.at(-1).id : null });
  } catch (cause) {
    if (cause.code === 'P2025') return res.status(400).json({ message: 'Cursor inválido.' });
    error(res, cause);
  }
});

router.post('/posts/:id/comments', async (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
  if (!content || content.length > 1000 || (parentId && parentId.length > 100))
    return res.status(400).json({ message: 'Comentário inválido.' });
  try {
    const post = await socialFeed.visiblePost(req.userId, req.params.id);
    if (!post) return res.status(404).json({ message: 'Publicação não encontrada.' });
    const parent = parentId ? await prisma.postComment.findFirst({ where: { id: parentId, postId: post.id },
      select: { id: true, userId: true, parentId: true } }) : null;
    if (parentId && !parent) return res.status(400).json({ message: 'Resposta inválida.' });
    if (parent?.parentId) return res.status(400).json({ message: 'Responda ao comentário principal.' });
    const comment = await prisma.postComment.create({ data: { postId: post.id, userId: req.userId,
      parentId: parent?.id || null, content }, select: commentSelect });
    const recipients = [...new Set([post.userId, parent?.userId].filter(id => id && id !== req.userId))];
    for (const recipientId of recipients) void notifications.publish({ recipientId, actorId: req.userId,
      kind: 'POST_COMMENT', sourceKey: `post-comment:${comment.id}:${recipientId}`,
      title: parent?.userId === recipientId ? 'Responderam seu comentário' : 'Comentaram sua publicação',
      body: content.slice(0, 180), href: `/feed.html?post=${encodeURIComponent(post.id)}#comment-${comment.id}`,
      io: req.app.get('io') }).catch(cause => console.error('Falha na notificação de comentário:', cause));
    res.status(201).json({ comment });
  } catch (cause) { error(res, cause); }
});

router.delete('/comments/:id', async (req, res) => {
  try {
    const comment = await prisma.postComment.findUnique({ where: { id: req.params.id },
      select: { id: true, userId: true, post: { select: { userId: true } } } });
    if (!comment) return res.status(404).json({ message: 'Comentário não encontrado.' });
    if (comment.userId !== req.userId && comment.post.userId !== req.userId && !await isSiteAdmin(req.userId))
      return res.status(403).json({ message: 'Sem permissão para excluir este comentário.' });
    await prisma.postComment.delete({ where: { id: comment.id } });
    res.json({ deleted: true });
  } catch (cause) { error(res, cause); }
});

router.put('/posts/:id/save', async (req, res) => {
  try {
    if (!await socialFeed.visiblePost(req.userId, req.params.id)) return res.status(404).json({ message: 'Publicação não encontrada.' });
    await prisma.savedPost.upsert({ where: { postId_userId: { postId: req.params.id, userId: req.userId } },
      create: { postId: req.params.id, userId: req.userId }, update: {} });
    res.json({ saved: true });
  } catch (cause) { error(res, cause); }
});
router.delete('/posts/:id/save', async (req, res) => {
  try { await prisma.savedPost.deleteMany({ where: { postId: req.params.id, userId: req.userId } }); res.json({ saved: false }); }
  catch (cause) { error(res, cause); }
});

router.put('/posts/:id/hide', async (req, res) => {
  try {
    if (!await socialFeed.visiblePost(req.userId, req.params.id)) return res.status(404).json({ message: 'Publicação não encontrada.' });
    await prisma.hiddenPost.upsert({ where: { postId_userId: { postId: req.params.id, userId: req.userId } },
      create: { postId: req.params.id, userId: req.userId }, update: {} });
    res.json({ hidden: true });
  } catch (cause) { error(res, cause); }
});
router.delete('/posts/:id/hide', async (req, res) => {
  try { await prisma.hiddenPost.deleteMany({ where: { postId: req.params.id, userId: req.userId } }); res.json({ hidden: false }); }
  catch (cause) { error(res, cause); }
});

router.post('/posts/:id/report', async (req, res) => {
  const reason = req.body?.reason;
  const details = typeof req.body?.details === 'string' ? req.body.details.trim() : '';
  if (!['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'OTHER'].includes(reason) || details.length > 500)
    return res.status(400).json({ message: 'Denúncia inválida.' });
  try {
    const post = await socialFeed.visiblePost(req.userId, req.params.id);
    if (!post) return res.status(404).json({ message: 'Publicação não encontrada.' });
    if (post.userId === req.userId) return res.status(400).json({ message: 'Você não pode denunciar sua publicação.' });
    await moderation.submitReport({ reporterId: req.userId, kind: 'POST', targetId: post.id,
      reason, details });
    res.status(201).json({ reported: true });
  } catch (cause) {
    error(res, cause);
  }
});

router.post('/posts/:id/share', async (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const roomId = typeof req.body?.roomId === 'string' ? req.body.roomId : null;
  if (content.length > 1000 || (roomId && roomId.length > 100)) return res.status(400).json({ message: 'Compartilhamento inválido.' });
  try {
    const original = await socialFeed.visiblePost(req.userId, req.params.id);
    if (!original) return res.status(404).json({ message: 'Publicação não encontrada.' });
    if (original.sharedPostId) return res.status(400).json({ message: 'Compartilhe a publicação original.' });
    if (roomId && !await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: req.userId, roomId } } }))
      return res.status(403).json({ message: 'Entre na comunidade para publicar nela.' });
    if (roomId && await moderation.activeSanction(roomId, req.userId, ['SUSPEND']))
      return res.status(403).json({ message: 'Sua participação está suspensa temporariamente.' });
    const post = await prisma.post.create({ data: { userId: req.userId, content,
      sharedPostId: original.id, roomId }, select: { id: true } });
    res.status(201).json({ postId: post.id });
  } catch (cause) {
    if (cause.code === 'P2002') return res.status(409).json({ message: 'Você já compartilhou esta publicação.' });
    error(res, cause);
  }
});

module.exports = router;
