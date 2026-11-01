const express = require("express");
const prisma = require("../database/prisma");
const auth = require("../middleware/authMiddleware");
const projectionRep = require('../services/projectionRep');
const { isSiteAdmin } = require('../middleware/siteAdmin');
const { topicCodes } = require('../services/community');
const gamification = require('../services/gamification');
const notifications = require('../services/notifications');
const moderation = require('../services/moderation');
const { randomBytes } = require('node:crypto');

const router = express.Router();
router.use(auth);
const newInviteCode = () => randomBytes(24).toString('base64url');
const invitePath = code => `/index.html?convite=${encodeURIComponent(code)}`;
const validInviteCode = code => typeof code === 'string' && /^[a-zA-Z0-9_-]{32}$/.test(code);
async function privateMember(roomId, userId) {
  return prisma.roomMember.findUnique({ where: { userId_roomId: { userId, roomId } }, select: { role: true } });
}

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
      where: { AND: [{ OR: [{ id: "geral" }, { ownerId: { not: null } }] },
        { OR: [{ isPrivate: false }, { members: { some: { userId: req.userId } } }] }] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, description: true, category: true, topic: true,
        banner: true, ownerId: true, isPrivate: true, createdAt: true,
        _count: { select: { members: true } },
      },
    });

    const adapterRooms = req.app.get("io").sockets.adapter.rooms;
    const onlineUsers = req.app.get("io").sockets.sockets;
    const result = rooms.map((room) => {
      const users = new Set();
      for (const socketId of adapterRooms.get(room.id) || []) {
        const userId = onlineUsers.get(socketId)?.user?.id;
        if (userId && onlineUsers.get(socketId)?.user?.presenceStatus !== 'INVISIBLE') users.add(userId);
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

router.get('/private', async (req, res) => {
  try {
    const rooms = await prisma.room.findMany({ where: { isPrivate: true,
      members: { some: { userId: req.userId } } }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, name: true, description: true, category: true, banner: true,
        _count: { select: { members: true } } } });
    res.json({ rooms: rooms.map(({ _count, ...room }) => ({ ...room, membersCount: _count.members })) });
  } catch (error) { console.error('Erro ao listar chats privados:', error);
    res.status(500).json({ message: 'Não foi possível carregar os chats privados.' }); }
});

router.post('/invites/:code/join', async (req, res) => {
  if (!validInviteCode(req.params.code)) return res.status(404).json({ message: 'Convite inválido.' });
  try {
    const room = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "inviteCode" = ${req.params.code} AND "isPrivate" = true FOR UPDATE`;
      if (!rows.length) return null;
      const roomId = rows[0].id;
      const sanction = await tx.communitySanction.findFirst({ where: { roomId, userId: req.userId,
        type: 'SUSPEND', revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (sanction) return 'SUSPENDED';
      await tx.roomMember.upsert({ where: { userId_roomId: { userId: req.userId, roomId } },
        create: { userId: req.userId, roomId, role: 'MEMBER' }, update: {} });
      return { id: roomId };
    });
    if (!room) return res.status(404).json({ message: 'Convite expirado ou revogado.' });
    if (room === 'SUSPENDED') return res.status(403).json({ message: 'Sua participação está suspensa neste chat.' });
    req.app.get('io').to(room.id).emit('room-members-count', { roomId: room.id,
      membersCount: await prisma.roomMember.count({ where: { roomId: room.id } }) });
    res.json({ room });
  } catch (error) { console.error('Erro ao aceitar convite:', error);
    res.status(500).json({ message: 'Não foi possível entrar no chat privado.' }); }
});

router.get('/:id/invite', async (req, res) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.id },
      select: { id: true, isPrivate: true, inviteCode: true } });
    if (!room?.isPrivate || !room.inviteCode || !await privateMember(room.id, req.userId))
      return res.status(404).json({ message: 'Chat privado não encontrado.' });
    res.set('Cache-Control', 'no-store').json({ link: invitePath(room.inviteCode) });
  } catch (error) { console.error('Erro ao carregar convite:', error);
    res.status(500).json({ message: 'Não foi possível carregar o convite.' }); }
});

router.post('/:id/invite/rotate', async (req, res) => {
  try {
    const member = await privateMember(req.params.id, req.userId);
    const room = await prisma.room.findUnique({ where: { id: req.params.id },
      select: { id: true, isPrivate: true } });
    if (!room?.isPrivate || !['OWNER', 'CO_ADMIN'].includes(member?.role))
      return res.status(403).json({ message: 'Apenas a equipe pode renovar o link.' });
    const inviteCode = newInviteCode();
    await prisma.room.update({ where: { id: room.id }, data: { inviteCode } });
    req.app.get('io').to(room.id).emit('room-invite-rotated', { roomId: room.id });
    res.set('Cache-Control', 'no-store').json({ link: invitePath(inviteCode) });
  } catch (error) { console.error('Erro ao renovar convite:', error);
    res.status(500).json({ message: 'Não foi possível renovar o link.' }); }
});

router.post('/:id/invite-user', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (username.length < 3 || username.length > 50) return res.status(400).json({ message: 'Informe o nome da pessoa.' });
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.id },
      select: { id: true, name: true, isPrivate: true, inviteCode: true } });
    if (!room?.isPrivate || !room.inviteCode || !await privateMember(room.id, req.userId))
      return res.status(403).json({ message: 'Entre no chat para convidar.' });
    const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true } });
    if (!user || user.id === req.userId) return res.status(404).json({ message: 'Pessoa não encontrada.' });
    if (await privateMember(room.id, user.id)) return res.status(409).json({ message: 'Esta pessoa já participa do chat.' });
    const recent = await prisma.notification.count({ where: { actorId: req.userId, kind: 'ROOM_INVITE',
      createdAt: { gte: new Date(Date.now() - 3600000) } } });
    if (recent >= 20) return res.status(429).json({ message: 'Limite de convites atingido. Tente mais tarde.' });
    const sender = await prisma.user.findUnique({ where: { id: req.userId }, select: { username: true } });
    const sent = await notifications.publish({ recipientId: user.id, actorId: req.userId,
      kind: 'ROOM_INVITE', sourceKey: `room-invite:${room.id}:${user.id}:${Math.floor(Date.now() / 3600000)}`,
      title: `Convite para ${room.name}`, body: `${sender?.username || 'Uma pessoa'} convidou você para um chat privado.`,
      href: invitePath(room.inviteCode), io: req.app.get('io') });
    res.json({ sent: Boolean(sent) });
  } catch (error) { console.error('Erro ao convidar pessoa:', error);
    res.status(500).json({ message: 'Não foi possível enviar o convite.' }); }
});

router.get('/:id/summary', async (req, res) => {
  try {
    if (req.params.id === 'geral') await ensureMainRoom();
    const room = await prisma.room.findUnique({ where: { id: req.params.id },
      select: { id: true, name: true, description: true, category: true, topic: true,
        banner: true, ownerId: true, isPrivate: true, createdAt: true, _count: { select: { members: true } } } });
    if (!room || (room.id !== 'geral' && !room.ownerId)) return res.sendStatus(404);
    if (room.isPrivate && !await privateMember(room.id, req.userId)) return res.sendStatus(404);
    const io = req.app.get('io');
    const online = new Set();
    for (const socketId of io.sockets.adapter.rooms.get(room.id) || []) {
      const user = io.sockets.sockets.get(socketId)?.user;
      if (user && user.presenceStatus !== 'INVISIBLE') online.add(user.id);
    }
    res.json({ room: { ...room, membersCount: room._count.members, onlineCount: online.size,
      isMain: room.id === 'geral', _count: undefined } });
  } catch (error) { console.error('Erro ao carregar sala:', error);
    res.status(500).json({ message: 'Não foi possível carregar a sala.' }); }
});

router.get("/:id/members", async (req, res) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, description: true, isPrivate: true },
    });
    if (!room) return res.status(404).json({ message: "Chat não encontrado." });
    if (room.isPrivate && !await privateMember(room.id, req.userId)) return res.sendStatus(404);
    const members = await prisma.roomMember.findMany({
      where: { roomId: room.id },
      orderBy: { joinedAt: "asc" },
      select: { role: true, user: { select: { id: true, username: true, avatar: true } } },
    });
    res.json({ room, members });
  } catch (error) {
    console.error("Erro ao listar participantes:", error);
    res.status(500).json({ message: "Não foi possível carregar os participantes." });
  }
});

router.post("/", async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const banner = typeof req.body.banner === "string" ? req.body.banner.trim() : "";
  const topic = req.body.topic || 'GERAL';
  const isPrivate = req.body.isPrivate === 'true' || req.body.isPrivate === true;
  if (req.body.isPrivate !== undefined && !['true', 'false', true, false].includes(req.body.isPrivate))
    return res.status(400).json({ message: 'Tipo de chat inválido.' });
  if (name.length < 3 || name.length > 50 || description.length > 200 || banner.length > 1000) {
    return res.status(400).json({ message: "Informe um nome de 3 a 50 caracteres. A descrição aceita até 200 caracteres." });
  }
  if (banner && !/^https?:\/\//i.test(banner)) {
    return res.status(400).json({ message: "A imagem precisa ser uma URL http ou https." });
  }
  if (!topicCodes.has(topic)) return res.status(400).json({ message: 'Categoria inválida.' });
  try {
    const room = await prisma.$transaction(async (tx) => {
      const created = await tx.room.create({
        data: {
          name, description: description || null, banner: banner || null, topic,
          isPrivate, inviteCode: isPrivate ? newInviteCode() : null,
          ownerId: req.userId,
          members: { create: { userId: req.userId, role: "OWNER" } },
        },
        select: { id: true },
      });
      return created;
    });
    res.status(201).json({ room });
    void gamification.syncAchievements(req.userId, req.app.get('io')).catch(error => console.error('Falha ao conferir conquistas:', error));
  } catch (error) {
    console.error("Erro ao criar sala:", error);
    res.status(500).json({ message: "Não foi possível criar a sala." });
  }
});

async function manageableRoom(req, res, allowCoAdmin = true) {
  const room = await prisma.room.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, description: true, banner: true, topic: true, ownerId: true, isPrivate: true },
  });
  if (!room) {
    res.status(404).json({ message: "Chat não encontrado." });
    return null;
  }
  if (!room.isPrivate && await isSiteAdmin(req.userId)) return { room, role: 'OWNER' };
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
    const topic = req.body.topic ?? access.room.topic;
    if (name.length < 3 || name.length > 50 || description.length > 200 || banner.length > 1000 ||
        (banner && !/^https?:\/\//i.test(banner)) || !topicCodes.has(topic)) {
      return res.status(400).json({ message: "Confira nome, descrição e URL da capa." });
    }
    const room = await prisma.room.update({
      where: { id: access.room.id },
      data: { name, description: description || null, banner: banner || null, topic },
      select: { id: true, name: true, description: true, banner: true, topic: true },
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
    if (await isSiteAdmin(req.params.userId)) return res.status(403).json({ message: 'O administrador geral não pode ter sua permissão alterada.' });
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
          role: socket.user.isSiteAdmin ? 'OWNER' : role,
          canStartLive: socket.user.isSiteAdmin || role === "CO_ADMIN",
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
    if (await isSiteAdmin(req.params.userId)) return res.status(403).json({ message: 'O administrador geral não pode ser removido do chat.' });
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

    const deleted = await prisma.$transaction(async tx => {
      const result = await tx.roomMember.deleteMany({
        where: { roomId: access.room.id, userId: req.params.userId, role: target.role },
      });
      if (result.count) await tx.moderationAction.create({ data: { actorId: req.userId,
        targetUserId: req.params.userId, roomId: access.room.id, action: 'REMOVE_MEMBER',
        targetType: 'USER', targetId: req.params.userId, reason: 'Removido pela equipe da comunidade.' } });
      if (result.count && access.room.isPrivate) await tx.room.update({ where: { id: access.room.id },
        data: { inviteCode: newInviteCode() } });
      return result;
    });
    if (!deleted.count) return res.status(409).json({ message: "A permissão do participante mudou. Atualize a lista." });
    if (access.room.isPrivate) {
      req.app.get('io').to(access.room.id).emit('room-invite-rotated', { roomId: access.room.id });
    }
    req.app.get('removeVoiceUser')?.(access.room.id, req.params.userId);
    await prisma.eventParticipant.deleteMany({ where: { userId: req.params.userId,
      attendedAt: null, event: { roomId: access.room.id, startsAt: { gt: new Date() } } } });

    const io = req.app.get("io");
    await req.app.get('settleProjection')(access.room.id);
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
    const projection = await prisma.liveSession.findFirst({ where: { roomId: access.room.id, status: 'ACTIVE' }, select: { id: true, hostId: true } });
    if (projection && projection.hostId !== req.params.userId && !onlineUsers.has(req.params.userId)) {
      await projectionRep.recordLeave(projection.id, req.params.userId);
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
