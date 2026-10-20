const express = require("express");
const prisma = require("../database/prisma");
const auth = require("../middleware/authMiddleware");
const reputation = require('../services/reputation');
const { notify } = require('./reputationRoutes');
const { isSiteAdmin } = require('../middleware/siteAdmin');

const router = express.Router();
router.use(auth);

async function profile(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, username: true, avatar: true, banner: true,
        bio: true, xp: true, level: true, createdAt: true,
        _count: { select: { followers: true, following: true, posts: true } },
      },
    });
    if (!user) return res.status(404).json({ message: "Perfil não encontrado." });
    const follow = req.userId === user.id ? null : await prisma.follow.findUnique({
      where: { followerId_followedId: { followerId: req.userId, followedId: user.id } },
    });
    const [rank, checkin, moderator] = await Promise.all([
      prisma.user.count({ where: { OR: [{ xp: { gt: user.xp } }, { xp: user.xp, id: { lt: user.id } }] } }),
      reputation.checkinStatus(user.id),
      prisma.roomMember.findFirst({ where: { userId: req.userId, role: { in: ['OWNER', 'CO_ADMIN'] } }, select: { id: true } }),
    ]);
    res.json({
      user: {
        ...user,
        ...reputation.progress(user.xp), rank: rank + 1, checkin, viewerIsModerator: Boolean(moderator) || await isSiteAdmin(req.userId),
        followersCount: user._count.followers,
        followingCount: user._count.following,
        postsCount: user._count.posts,
        isFollowing: Boolean(follow),
        isSelf: req.userId === user.id,
        _count: undefined,
      },
    });
  } catch (error) {
    console.error("Erro ao carregar perfil:", error);
    res.status(500).json({ message: "Não foi possível carregar o perfil." });
  }
}

router.get("/users/:id", profile);

async function listConnections(req, res, kind) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ message: "Perfil não encontrado." });

    const offset = Math.max(0, Math.min(10000, Number.parseInt(req.query.offset, 10) || 0));
    const isFollowers = kind === "followers";
    const follows = await prisma.follow.findMany({
      where: isFollowers ? { followedId: user.id } : { followerId: user.id },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: 51,
      select: {
        follower: isFollowers ? { select: { id: true, username: true, avatar: true, bio: true } } : false,
        followed: isFollowers ? false : { select: { id: true, username: true, avatar: true, bio: true } },
      },
    });
    res.json({
      users: follows.slice(0, 50).map((follow) => isFollowers ? follow.follower : follow.followed),
      hasMore: follows.length > 50,
      nextOffset: offset + Math.min(follows.length, 50),
    });
  } catch (error) {
    console.error("Erro ao listar conexões do perfil:", error);
    res.status(500).json({ message: "Não foi possível carregar esta lista." });
  }
}

router.get("/users/:id/followers", (req, res) => listConnections(req, res, "followers"));
router.get("/users/:id/following", (req, res) => listConnections(req, res, "following"));

router.post("/users/:id/follow", async (req, res) => {
  if (req.params.id === req.userId) return res.status(400).json({ message: "Você não pode seguir a si mesmo." });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) return res.status(404).json({ message: "Perfil não encontrado." });
    await prisma.follow.upsert({
      where: { followerId_followedId: { followerId: req.userId, followedId: user.id } },
      update: {},
      create: { followerId: req.userId, followedId: user.id },
    });
    res.json({ isFollowing: true });
  } catch (error) {
    console.error("Erro ao seguir usuário:", error);
    res.status(500).json({ message: "Não foi possível seguir este usuário." });
  }
});

router.delete("/users/:id/follow", async (req, res) => {
  try {
    await prisma.follow.deleteMany({ where: { followerId: req.userId, followedId: req.params.id } });
    res.json({ isFollowing: false });
  } catch (error) {
    console.error("Erro ao deixar de seguir:", error);
    res.status(500).json({ message: "Não foi possível deixar de seguir." });
  }
});

router.get("/users/:id/posts", async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: { userId: req.params.id }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, content: true, createdAt: true, featuredAt: true, likes: { where: { userId: req.userId }, select: { userId: true } }, _count: { select: { likes: true } } },
    });
    res.json({ posts });
  } catch (error) {
    console.error("Erro ao listar posts:", error);
    res.status(500).json({ message: "Não foi possível carregar os posts." });
  }
});

router.post("/posts", async (req, res) => {
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (!content || content.length > 1000) return res.status(400).json({ message: "O post deve ter entre 1 e 1000 caracteres." });
  try {
    const { post, xpResult } = await prisma.$transaction(async tx => {
      const post = await tx.post.create({ data: { content, userId: req.userId }, select: { id: true, content: true, createdAt: true } });
      const user = await reputation.locked(tx, req.userId);
      const xpResult = await reputation.award(tx, user, 10, 'POST_CREATED', `post:${post.id}`);
      return { post, xpResult };
    });
    notify(req, req.userId, xpResult, 'POST_CREATED');
    res.status(201).json({ post });
  } catch (error) {
    console.error("Erro ao publicar post:", error);
    res.status(500).json({ message: "Não foi possível publicar." });
  }
});

router.post('/posts/:id/like', async (req, res) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true } });
    if (!post) return res.status(404).json({ message: 'Publicação não encontrada.' });
    if (post.userId === req.userId) return res.status(400).json({ message: 'Você não pode curtir sua publicação.' });
    const result = await prisma.$transaction(async tx => {
      const user = await reputation.locked(tx, post.userId);
      const inserted = await tx.$queryRaw`INSERT INTO "PostLike" ("postId", "userId") VALUES (${post.id}, ${req.userId}) ON CONFLICT DO NOTHING RETURNING "postId"`;
      if (!inserted.length) return null;
      return reputation.award(tx, user, 1, 'POST_LIKED', `like:${post.id}:${req.userId}`);
    });
    if (result) notify(req, post.userId, result, 'POST_LIKED');
    res.json({ liked: true, awarded: Boolean(result?.gainedXp) });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Não foi possível curtir.' }); }
});

router.post('/posts/:id/feature', async (req, res) => {
  try {
    const moderator = await prisma.roomMember.findFirst({ where: { userId: req.userId, role: { in: ['OWNER', 'CO_ADMIN'] } }, select: { id: true } });
    if (!moderator && !await isSiteAdmin(req.userId)) return res.status(403).json({ message: 'Apenas moderadores podem destacar.' });
    const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true } });
    if (!post) return res.status(404).json({ message: 'Publicação não encontrada.' });
    const result = await prisma.$transaction(async tx => {
      const user = await reputation.locked(tx, post.userId);
      const updated = await tx.post.updateMany({ where: { id: post.id, featuredAt: null }, data: { featuredAt: new Date(), featuredById: req.userId } });
      if (!updated.count) return null;
      return reputation.award(tx, user, 20, 'POST_FEATURED', `feature:${post.id}`);
    });
    if (result) notify(req, post.userId, result, 'POST_FEATURED');
    res.json({ featured: true, awarded: Boolean(result?.gainedXp) });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Não foi possível destacar.' }); }
});

router.delete('/posts/:id', async (req, res) => {
  try {
    if (!await isSiteAdmin(req.userId)) return res.status(403).json({ message: 'Apenas a administração geral pode excluir publicações.' });
    const deleted = await prisma.post.deleteMany({ where: { id: req.params.id } });
    if (!deleted.count) return res.status(404).json({ message: 'Publicação não encontrada.' });
    res.json({ deleted: true });
  } catch (error) {
    console.error('Erro ao excluir publicação:', error);
    res.status(500).json({ message: 'Não foi possível excluir a publicação.' });
  }
});

module.exports = router;
