const express = require("express");
const prisma = require("../database/prisma");
const auth = require("../middleware/authMiddleware");

const router = express.Router();
router.use(auth);

async function ensureMainRoom() {
  await prisma.room.upsert({
    where: { id: "geral" },
    update: {},
    create: {
      id: "geral", name: "Geral", description: "Converse sobre qualquer assunto.", category: "🔥",
    },
  });
}

router.get("/", async (req, res) => {
  try {
    await ensureMainRoom();
    const rooms = await prisma.room.findMany({
      where: { OR: [{ id: "geral" }, { ownerId: { not: null } }] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, description: true, category: true,
        banner: true, ownerId: true, createdAt: true,
        _count: { select: { members: true } },
      },
    });

    const adapterRooms = req.app.get("io").sockets.adapter.rooms;
    const onlineUsers = req.app.get("io").sockets.sockets;
    const result = rooms.map((room) => {
      const users = new Set();
      for (const socketId of adapterRooms.get(room.id) || []) {
        const userId = onlineUsers.get(socketId)?.user?.id;
        if (userId) users.add(userId);
      }
      return {
        ...room,
        membersCount: room._count.members,
        onlineCount: users.size,
        isMain: room.id === "geral",
        _count: undefined,
      };
    });
    result.sort((a, b) => Number(b.isMain) - Number(a.isMain));
    res.json({ rooms: result });
  } catch (error) {
    console.error("Erro ao listar salas:", error);
    res.status(500).json({ message: "Não foi possível carregar as salas." });
  }
});

router.post("/", async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const banner = typeof req.body.banner === "string" ? req.body.banner.trim() : "";
  if (name.length < 3 || name.length > 50 || description.length > 200 || banner.length > 1000) {
    return res.status(400).json({ message: "Informe um nome de 3 a 50 caracteres. A descrição aceita até 200 caracteres." });
  }
  if (banner && !/^https?:\/\//i.test(banner)) {
    return res.status(400).json({ message: "A imagem precisa ser uma URL http ou https." });
  }
  try {
    const room = await prisma.$transaction(async (tx) => {
      const created = await tx.room.create({
        data: {
          name, description: description || null, banner: banner || null,
          ownerId: req.userId,
          members: { create: { userId: req.userId, role: "OWNER" } },
        },
        select: { id: true },
      });
      const user = await tx.user.update({
        where: { id: req.userId }, data: { xp: { increment: 50 } },
        select: { xp: true, level: true },
      });
      const level = Math.floor(user.xp / 100) + 1;
      if (level !== user.level) await tx.user.update({ where: { id: req.userId }, data: { level } });
      return created;
    });
    res.status(201).json({ room });
  } catch (error) {
    console.error("Erro ao criar sala:", error);
    res.status(500).json({ message: "Não foi possível criar a sala." });
  }
});

async function manageableRoom(req, res, allowCoAdmin = true) {
  const room = await prisma.room.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, description: true, banner: true, ownerId: true },
  });
  if (!room) {
    res.status(404).json({ message: "Chat não encontrado." });
    return null;
  }
  if (!room.ownerId) {
    res.status(403).json({ message: "Este chat não pode ser modificado." });
    return null;
  }
  const membership = await prisma.roomMember.findUnique({
    where: { userId_roomId: { userId: req.userId, roomId: room.id } },
    select: { role: true },
  });
  const isOwner = room.ownerId === req.userId && membership?.role === "OWNER";
  const isCoAdmin = allowCoAdmin && membership?.role === "CO_ADMIN";
  if (!isOwner && !isCoAdmin) {
    res.status(403).json({ message: "Você não pode administrar este chat." });
    return null;
  }
  return { room, role: membership.role };
}

router.get("/:id/admin", async (req, res) => {
  try {
    const access = await manageableRoom(req, res);
    if (!access) return;
    const members = await prisma.roomMember.findMany({
      where: { roomId: access.room.id },
      orderBy: { joinedAt: "asc" },
      select: {
        role: true,
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
    res.json({ room: access.room, role: access.role, members });
  } catch (error) {
    console.error("Erro ao carregar administração:", error);
    res.status(500).json({ message: "Não foi possível carregar a administração." });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const access = await manageableRoom(req, res);
    if (!access) return;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    const banner = typeof req.body.banner === "string" ? req.body.banner.trim() : "";
    if (name.length < 3 || name.length > 50 || description.length > 200 || banner.length > 1000 ||
        (banner && !/^https?:\/\//i.test(banner))) {
      return res.status(400).json({ message: "Confira nome, descrição e URL da capa." });
    }
    const room = await prisma.room.update({
      where: { id: access.room.id },
      data: { name, description: description || null, banner: banner || null },
      select: { id: true, name: true, description: true, banner: true },
    });
    req.app.get("io").to(room.id).emit("room-updated", room);
    res.json({ room });
  } catch (error) {
    console.error("Erro ao atualizar chat:", error);
    res.status(500).json({ message: "Não foi possível atualizar o chat." });
  }
});

router.patch("/:id/members/:userId/role", async (req, res) => {
  try {
    const access = await manageableRoom(req, res, false);
    if (!access) return;
    const role = req.body.role;
    if (!["MEMBER", "CO_ADMIN"].includes(role) || req.params.userId === req.userId) {
      return res.status(400).json({ message: "Permissão inválida." });
    }
    const updated = await prisma.roomMember.updateMany({
      where: { roomId: access.room.id, userId: req.params.userId, role: { not: "OWNER" } },
      data: { role },
    });
    if (!updated.count) return res.status(404).json({ message: "Participante não encontrado." });
    const io = req.app.get("io");
    for (const socket of io.sockets.sockets.values()) {
      if (socket.user?.id === req.params.userId && socket.rooms.has(access.room.id)) {
        socket.emit("room-permissions", {
          roomId: access.room.id,
          role,
          canStartLive: role === "CO_ADMIN",
        });
      }
    }
    res.json({ role });
  } catch (error) {
    console.error("Erro ao atualizar coadmin:", error);
    res.status(500).json({ message: "Não foi possível alterar a permissão." });
  }
});

router.delete("/:id/members/:userId", async (req, res) => {
  try {
    const access = await manageableRoom(req, res);
    if (!access) return;
    if (req.params.userId === req.userId) {
      return res.status(400).json({ message: "Você não pode remover a si mesmo." });
    }
    const target = await prisma.roomMember.findUnique({
      where: { userId_roomId: { userId: req.params.userId, roomId: access.room.id } },
      select: { role: true },
    });
    if (!target) return res.status(404).json({ message: "Participante não encontrado." });
    if (target.role === "OWNER" || (access.role === "CO_ADMIN" && target.role !== "MEMBER")) {
      return res.status(403).json({ message: "Você não pode remover este participante." });
    }

    const deleted = await prisma.roomMember.deleteMany({
      where: { roomId: access.room.id, userId: req.params.userId, role: target.role },
    });
    if (!deleted.count) return res.status(409).json({ message: "A permissão do participante mudou. Atualize a lista." });

    const io = req.app.get("io");
    for (const socket of io.sockets.sockets.values()) {
      if (socket.user?.id === req.params.userId && socket.rooms.has(access.room.id)) {
        socket.emit("room-removed", { roomId: access.room.id, message: "Você foi removido deste chat." });
        socket.leave(access.room.id);
      }
    }
    const onlineUsers = new Set();
    for (const socketId of io.sockets.adapter.rooms.get(access.room.id) || []) {
      const userId = io.sockets.sockets.get(socketId)?.user?.id;
      if (userId) onlineUsers.add(userId);
    }
    io.to(access.room.id).emit("room-presence", { roomId: access.room.id, onlineCount: onlineUsers.size });
    const membersCount = await prisma.roomMember.count({ where: { roomId: access.room.id } });
    io.to(access.room.id).emit("room-members-count", { roomId: access.room.id, membersCount });

    const hostedLive = await prisma.liveSession.findFirst({
      where: { roomId: access.room.id, status: "ACTIVE", hostId: req.params.userId },
      select: { id: true },
    });
    if (hostedLive || !onlineUsers.size) await req.app.get("endLiveSession")(access.room.id);
    res.json({ removed: true });
  } catch (error) {
    console.error("Erro ao remover participante:", error);
    res.status(500).json({ message: "Não foi possível remover o participante." });
  }
});

module.exports = router;
