const express = require("express");
const prisma = require("../database/prisma");
const auth = require("../middleware/authMiddleware");

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
    res.json({
      user: {
        ...user,
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
      select: { id: true, content: true, createdAt: true },
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
    const post = await prisma.post.create({
      data: { content, userId: req.userId },
      select: { id: true, content: true, createdAt: true },
    });
    res.status(201).json({ post });
  } catch (error) {
    console.error("Erro ao publicar post:", error);
    res.status(500).json({ message: "Não foi possível publicar." });
  }
});

module.exports = router;
