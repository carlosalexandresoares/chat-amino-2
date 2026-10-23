require("dotenv").config();

const jwt = require("jsonwebtoken");
const prisma = require("./database/prisma");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const authRoutes = require("./routes/authRoutes");
const roomRoutes = require("./routes/roomRoutes");
const socialRoutes = require("./routes/socialRoutes");
const socialFeedRoutes = require('./routes/socialFeedRoutes');
const gamificationRoutes = require('./routes/gamificationRoutes');
const gamification = require('./services/gamification');
const reputation = require('./services/reputation');
const reputationRoutes = require('./routes/reputationRoutes');
const projectionRep = require('./services/projectionRep');
const projectionRoutes = require('./routes/projectionRoutes');
const chatMessages = require('./services/chatMessages');
const chatRoutes = require('./routes/chatRoutes');
const directRoutes = require('./routes/directRoutes');
const siteAdminRoutes = require('./routes/siteAdminRoutes');
const chatMedia = require('./services/chatMedia');
const direct = require('./services/direct');
const { loadSocketUser } = require('./services/socketUser');
const notificationRoutes = require('./routes/notificationRoutes');
const communityRoutes = require('./routes/communityRoutes');
const eventRoutes = require('./routes/eventRoutes');
const eventReminders = require('./services/eventReminders');
const moderationRoutes = require('./routes/moderationRoutes');
const moderation = require('./services/moderation');
const antiSpam = require('./services/antiSpam');
const { createVoiceService } = require('./services/voiceRooms');
const notifications = require('./services/notifications');

const app = express();

app.use(cors());
app.use(express.json());

// Servir o frontend da pasta public
app.use(express.static(path.join(__dirname, "../public")));

// Rotas de autenticação
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api", socialRoutes);
app.use('/api/social', socialFeedRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api', reputationRoutes.router);
app.use('/api/projections', projectionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/direct', directRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/admin', siteAdminRoutes);
setInterval(() => chatMedia.cleanupOrphans(prisma).catch(error =>
  console.error('Erro na limpeza de arquivos do chat:', error)), 3600000).unref();

// Health check do Render
app.get("/healthz", (req, res) => {
  return res.status(200).json({
    status: "ok",
  });
});

app.get('/readyz', async (_req, res) => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'replace-with-a-long-random-secret')
    return res.status(503).json({ status: 'unavailable' });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: 'ready' });
  } catch {
    return res.status(503).json({ status: 'unavailable' });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});
app.set("io", io);
void eventReminders.sendDueReminders(io).catch(error => console.error('Erro nos lembretes de eventos:', error));
setInterval(() => eventReminders.sendDueReminders(io).catch(error =>
  console.error('Erro nos lembretes de eventos:', error)), 300000).unref();

function emitRoomPresence(roomId) {
  const users = new Set();
  for (const socketId of io.sockets.adapter.rooms.get(roomId) || []) {
    const userId = io.sockets.sockets.get(socketId)?.user?.id;
    if (userId && io.sockets.sockets.get(socketId)?.user?.presenceStatus !== 'INVISIBLE') users.add(userId);
  }
  io.to(roomId).emit("room-presence", { roomId, onlineCount: users.size });
}
app.set('refreshPresence', userId => {
  const rooms = new Set();
  for (const socket of io.sockets.sockets.values()) if (socket.user?.id === userId) {
    for (const roomId of socket.rooms) if (roomId !== socket.id && !roomId.startsWith('user:')) rooms.add(roomId);
  }
  for (const roomId of rooms) emitRoomPresence(roomId);
});

async function publishChatNotifications(saved, roomId, actor) {
  const href = `/index.html?sala=${encodeURIComponent(roomId)}&mensagem=${encodeURIComponent(saved.id)}`;
  const mentionedIds = new Set((saved.mentions || []).map(item => item.user.id));
  for (const recipientId of mentionedIds) if (recipientId !== actor.id) {
    await notifications.publish({ recipientId, actorId: actor.id, kind: 'MENTION',
      sourceKey: `mention:${saved.id}:${recipientId}`, title: 'Você foi mencionado',
      body: `${actor.username} mencionou você em uma mensagem.`, href, io });
  }
  const parentAuthorId = saved.replyTo?.userId;
  if (parentAuthorId && parentAuthorId !== actor.id && !mentionedIds.has(parentAuthorId)) {
    await notifications.publish({ recipientId: parentAuthorId, actorId: actor.id, kind: 'CHAT_REPLY',
      sourceKey: `reply:${saved.id}:${parentAuthorId}`, title: 'Responderam sua mensagem',
      body: `${actor.username} respondeu sua mensagem.`, href, io });
  }
}

async function publishProjectionStart(liveId, roomId, roomName, host) {
  if (roomId === 'geral') return;
  let cursor;
  for (;;) {
    const members = await prisma.roomMember.findMany({ where: { roomId }, orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, userId: true } });
    if (!members.length) return;
    await notifications.publishBatch({ recipientIds: members.map(item => item.userId), actorId: host.id,
      kind: 'PROJECTION_START', sourcePrefix: `projection:${liveId}`,
      title: 'Projeção iniciada', body: `${host.username} iniciou uma projeção em ${roomName}.`,
      href: `/index.html?sala=${encodeURIComponent(roomId)}#projections`, io });
    if (members.length < 100) return;
    cursor = members.at(-1).id;
  }
}

const projectionSettles = new Map();
function projectionEvidence(roomId, liveState) {
  const sockets = [...(io.sockets.adapter.rooms.get(roomId) || [])]
    .map(id => io.sockets.sockets.get(id)).filter(Boolean);
  return {
    playing: liveState.isPlaying, videoId: liveState.currentVideoId,
    hostConnected: sockets.some(socket => socket.user?.id === liveState.hostId),
    viewerIds: projectionRep.distinctViewerIds(new Map(sockets.map(socket => [socket.id, socket])), roomId, liveState.hostId),
  };
}
async function settleProjection(roomId) {
  const previous = projectionSettles.get(roomId);
  if (previous) await previous.catch(() => {});
  const state = liveStates[roomId];
  if (!state?.active) return;
  const task = projectionRep.settle(state.liveId, projectionEvidence(roomId, state));
  projectionSettles.set(roomId, task);
  try {
    const result = await task;
    if (!result) return;
    for (const { userId, result: xp } of result.viewerAwards) emitXpToUser(userId, xp, 'LIVE_VIEWER');
    const hostRep = await projectionRep.hostStatus(state.liveId, state.hostId);
    for (const socket of io.sockets.sockets.values()) if (socket.user?.id === state.hostId) {
      socket.emit('projection-rep', { liveId: state.liveId, hostRep });
    }
  } finally { if (projectionSettles.get(roomId) === task) projectionSettles.delete(roomId); }
}
app.set('settleProjection', settleProjection);
setInterval(() => {
  for (const roomId of Object.keys(liveStates)) settleProjection(roomId)
    .catch(error => console.error('Erro ao calcular REP de projeção:', error));
}, 30000).unref();

/*
  Estado temporário das lives.

  O banco mantém os dados permanentes.
  Este objeto mantém a sincronização rápida
  enquanto o servidor está ligado.
*/
const liveStates = {};
const voice = createVoiceService({ io, prisma, getActiveLive: roomId =>
  liveStates[roomId]?.active ? liveStates[roomId].liveId : null });
app.set('removeVoiceUser', voice.removeUser);
app.set('removeInvisibleVoiceUser', voice.removeInvisible);
const closingRooms = new Map();

function currentLiveTime(liveState) {
  if (!liveState) return 0;
  const elapsed = liveState.isPlaying && liveState.timeUpdatedAt
    ? (Date.now() - liveState.timeUpdatedAt) / 1000 : 0;
  return Math.max(0, liveState.currentTime + elapsed);
}

function setLiveClock(liveState, currentTime, isPlaying = liveState.isPlaying) {
  const time = Number(currentTime);
  liveState.currentTime = Number.isFinite(time) ? Math.max(0, time) : 0;
  liveState.isPlaying = isPlaying;
  liveState.timeUpdatedAt = Date.now();
}

function liveSyncSnapshot(liveState) {
  return {
    videoId: liveState.currentVideoId,
    currentTime: currentLiveTime(liveState),
    isPlaying: liveState.isPlaying,
  };
}

const liveSyncTimer = setInterval(() => {
  for (const [roomId, liveState] of Object.entries(liveStates)) {
    if (liveState.active && liveState.currentVideoId && io.sockets.adapter.rooms.get(roomId)?.size) {
      io.to(roomId).emit("video-sync", liveSyncSnapshot(liveState));
    }
  }
}, 2000);
liveSyncTimer.unref?.();

async function endLiveSession(roomId) {
  const live = await prisma.liveSession.findFirst({
    where: { roomId, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    select: { id: true, currentTime: true, hostId: true },
  });
  if (!live) {
    delete liveStates[roomId];
    return false;
  }

  if (liveStates[roomId]) await settleProjection(roomId);
  const finished = await projectionRep.finish(live.id,
    liveStates[roomId] ? currentLiveTime(liveStates[roomId]) : live.currentTime);
  delete liveStates[roomId];
  if (finished) io.to(roomId).emit("live-ended", { id: live.id });
  if (finished) void voice.unlinkProjection(live.id, roomId)
    .catch(error => console.error('Falha ao desvincular voz da projeção:', error));
  if (finished) void gamification.syncAchievements(live.hostId, io).catch(error => console.error('Falha ao conferir conquistas:', error));
  return finished;
}
app.set("endLiveSession", endLiveSession);

function endLiveWhenRoomEmpty(roomId) {
  if (io.sockets.adapter.rooms.get(roomId)?.size || closingRooms.has(roomId)) return;
  const closing = endLiveSession(roomId)
    .catch((error) => console.error("Erro ao encerrar live de sala vazia:", error))
    .finally(() => closingRooms.delete(roomId));
  closingRooms.set(roomId, closing);
}

/**
 * Envia as informações de XP somente
 * para o usuário que recebeu a recompensa.
 */
function emitXpResult(
  socket,
  xpResult,
  reason
) {
  if (
    !xpResult?.user ||
    !xpResult.gainedXp
  ) {
    return;
  }

  socket.emit("xp-updated", {
    reason,
    gainedXp:
      xpResult.gainedXp,
    xp: xpResult.user.xp,
    level:
      xpResult.user.level,
    ...reputation.progress(xpResult.user.xp),
  });

  if (xpResult.leveledUp) {
    socket.emit("level-up", {
      previousLevel:
        xpResult.previousLevel,
      level:
        xpResult.user.level,
      xp:
        xpResult.user.xp,
      ...reputation.progress(xpResult.user.xp),
    });
  }
}

/**
 * Atualiza os dados guardados no Socket.IO
 * depois que o usuário recebe XP.
 */
function updateSocketUser(
  socket,
  user
) {
  if (!user) {
    return;
  }

  socket.user = {
    ...socket.user,
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    xp: user.xp,
    level: user.level,
  };
}

function emitXpToUser(userId, result, reason) {
  for (const peer of io.sockets.sockets.values()) if (peer.user?.id === userId) {
    updateSocketUser(peer, result.user);
    emitXpResult(peer, result, reason);
  }
}

/**
 * Normaliza o ID de uma sala.
 */
function normalizeRoomId(roomId) {
  if (typeof roomId !== "string") {
    return "";
  }

  return roomId
    .trim()
    .toLowerCase();
}

/**
 * Confirma se o usuário é quem iniciou a live.
 */
function isLiveHost(
  roomId,
  userId
) {
  const liveState =
    liveStates[roomId];

  return Boolean(
    liveState &&
      liveState.active &&
      liveState.hostId === userId
  );
}

/**
 * Carrega a playlist atualizada do banco.
 */
async function loadLivePlaylist(
  liveId
) {
  return prisma.playlistItem.findMany({
    where: {
      liveId,
      status: {
        in: ["WAITING", "PLAYING"],
      },
    },
    orderBy: {
      position: "asc",
    },
  });
}

/**
 * Envia a playlist atualizada para todos da sala.
 */
async function emitUpdatedPlaylist(
  roomId
) {
  const liveState =
    liveStates[roomId];

  if (!liveState?.active) {
    return;
  }

  const playlist =
    await loadLivePlaylist(
      liveState.liveId
    );

  liveState.playlist =
    playlist;

  io.to(roomId).emit(
    "playlist-updated",
    playlist
  );
}

/**
 * Passa para o próximo vídeo da playlist.
 */
async function playNextVideo(
  roomId
) {
  const liveState =
    liveStates[roomId];

  if (!liveState?.active) {
    return {
      success: false,
      message:
        "Não existe uma live ativa.",
    };
  }

  await settleProjection(roomId);

  const nextItem =
    await prisma.playlistItem.findFirst({
      where: {
        liveId:
          liveState.liveId,
        status: "WAITING",
      },
      orderBy: {
        position: "asc",
      },
    });

  if (!nextItem) {
    await prisma.$transaction([
      prisma.playlistItem.updateMany({
        where: {
          liveId:
            liveState.liveId,
          status: "PLAYING",
        },
        data: {
          status: "PLAYED",
        },
      }),

      prisma.liveSession.update({
        where: {
          id: liveState.liveId,
        },
        data: {
          currentVideoId: null,
          currentTime: 0,
          isPlaying: false,
        },
      }),
    ]);

    liveState.currentVideoId =
      null;

    setLiveClock(liveState, 0, false);

    await emitUpdatedPlaylist(
      roomId
    );

    io.to(roomId).emit(
      "playlist-finished"
    );

    return {
      success: true,
      finished: true,
    };
  }

  await prisma.$transaction([
    prisma.playlistItem.updateMany({
      where: {
        liveId:
          liveState.liveId,
        status: "PLAYING",
      },
      data: {
        status: "PLAYED",
      },
    }),

    prisma.playlistItem.update({
      where: {
        id: nextItem.id,
      },
      data: {
        status: "PLAYING",
      },
    }),

    prisma.liveSession.update({
      where: {
        id: liveState.liveId,
      },
      data: {
        currentVideoId:
          nextItem.videoId,
        currentTime: 0,
        isPlaying: true,
      },
    }),
  ]);

  liveState.currentVideoId =
    nextItem.videoId;

  setLiveClock(liveState, 0, true);

  await emitUpdatedPlaylist(
    roomId
  );

  io.to(roomId).emit(
    "live-video-changed",
    {
      playlistItemId:
        nextItem.id,
      videoId:
        nextItem.videoId,
      title:
        nextItem.title,
      currentTime: 0,
      isPlaying: true,
    }
  );

  return {
    success: true,
    finished: false,
    item: nextItem,
  };
}

/*
  Autenticação do Socket.IO
*/
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token;

    if (!token) {
      return next(
        new Error(
          "Token não informado."
        )
      );
    }

    if (!process.env.JWT_SECRET) {
      console.error(
        "JWT_SECRET não está configurado."
      );

      return next(
        new Error(
          "Erro na configuração do servidor."
        )
      );
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const existingUser =
      await prisma.user.findUnique({
        where: {
          id: decoded.sub,
        },
        select: {
          id: true,
        },
      });

    if (!existingUser) {
      return next(
        new Error(
          "Usuário não encontrado."
        )
      );
    }

    /*
      Tenta aplicar o bônus diário.
      Se o usuário já recebeu hoje,
      nenhum XP adicional será concedido.
    */
    const currentUser = await loadSocketUser(prisma, existingUser.id);
    if (!currentUser) {
      return next(
        new Error(
          "Usuário não encontrado."
        )
      );
    }

    socket.user = currentUser;

    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      const authError = new Error("Token inválido ou expirado.");
      authError.data = { code: 'AUTH_INVALID' };
      return next(authError);
    }
    console.error("Erro ao conectar Socket.IO:", error);
    const serverError = new Error("O chat está temporariamente indisponível. Tente novamente em instantes.");
    serverError.data = { code: 'SERVER_UNAVAILABLE' };
    return next(serverError);
  }
});

io.on("connection", (socket) => {
  voice.attach(socket);
  socket.join(`user:${socket.user.id}`);
  socket.on('direct-typing', async ({ conversationId, typing } = {}) => {
    if (typeof conversationId !== 'string' || conversationId.length > 60 || typeof typing !== 'boolean') return;
    try {
      const conversation = await direct.access(socket.user.id, conversationId);
      if (!conversation || conversation.status !== 'ACTIVE' || await direct.blocked(conversation.userAId, conversation.userBId)) return;
      const recipient = await prisma.user.findUnique({ where: { id: direct.otherId(conversation, socket.user.id) }, select: { id: true, directPrivacy: true } });
      if (!recipient || !await direct.canRequest(socket.user.id, recipient)) return;
      io.to(`user:${recipient.id}`).emit('direct-typing', {
        conversationId, userId: socket.user.id, typing,
      });
    } catch (error) { console.error('Erro no indicador de digitação:', error); }
  });
  console.log(
    `Usuário conectado: ${socket.user.username} (${socket.id})`
  );

  /*
    Informa o bônus diário depois que
    a conexão do socket foi concluída.
  */

  /*
    Entrar na sala
  */
  socket.on(
    "join-room",
    async (roomId) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (
          !normalizedRoomId ||
          normalizedRoomId.length > 50
        ) {
          return;
        }

        const existingRoom =
          await prisma.room.findUnique({
            where: {
              id: normalizedRoomId,
            },
            select: {
              id: true,
              ownerId: true,
            },
          });

        if (!existingRoom || (normalizedRoomId !== "geral" && !existingRoom.ownerId)) {
          socket.emit("chat-error", { message: "Esta sala não existe mais." });
          return;
        }
        if (await moderation.activeSanction(normalizedRoomId, socket.user.id, ['SUSPEND'])) {
          socket.emit('chat-error', { message: 'Sua participação nesta comunidade está suspensa temporariamente.' });
          return;
        }

        /*
          O criador já é OWNER na criação do chat.
          Novos participantes sempre entram como MEMBER.
        */
        let membership =
          await prisma.roomMember.findUnique({
            where: {
              userId_roomId: {
                userId:
                  socket.user.id,
                roomId:
                  normalizedRoomId,
              },
            },
          });

        if (!membership) {
          membership =
            await prisma.roomMember.create({
              data: {
                userId:
                  socket.user.id,
                roomId:
                  normalizedRoomId,
                role: "MEMBER",
              },
            });
        }

        socket.join(
          normalizedRoomId
        );
        await closingRooms.get(normalizedRoomId);
        if (!liveStates[normalizedRoomId]) {
          // Uma live persistida sem estado em memória veio de uma execução anterior.
          await endLiveSession(normalizedRoomId);
        }
        emitRoomPresence(normalizedRoomId);
        const joinedCount = await prisma.roomMember.count({ where: { roomId: normalizedRoomId } });
        io.to(normalizedRoomId).emit("room-members-count", { roomId: normalizedRoomId, membersCount: joinedCount });

        socket.emit(
          "room-permissions",
          {
            roomId:
              normalizedRoomId,
            role:
              socket.user.isSiteAdmin ? 'OWNER' : membership.role,
            canStartLive:
              socket.user.isSiteAdmin ||
              membership.role ===
                "OWNER" ||
              membership.role ===
                "CO_ADMIN",
          }
        );

        /*
          Carregar últimas 100 mensagens
        */
        const history =
          await prisma.message.findMany({
            where: {
              roomId:
                normalizedRoomId,
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 40,
            select: chatMessages.messageSelect,
          });

        const formattedHistory = history.reverse().map(chatMessages.format);

        socket.emit(
          "chat-history",
          formattedHistory
        );

        /*
          Verificar se já existe live ativa
        */
        const activeLive =
          await prisma.liveSession.findFirst({
            where: {
              roomId:
                normalizedRoomId,
              status: "ACTIVE",
            },
            orderBy: {
              startedAt: "desc",
            },
            include: {
              host: {
                select: {
                  id: true,
                  username: true,
                  avatar: true,
                },
              },
              playlist: {
                where: {
                  status: {
                    in: [
                      "WAITING",
                      "PLAYING",
                    ],
                  },
                },
                orderBy: {
                  position: "asc",
                },
              },
            },
          });

        if (activeLive) {
          const viewers = projectionRep.distinctViewerIds(io.sockets.sockets, normalizedRoomId, activeLive.hostId);
          await projectionRep.recordJoin(activeLive.id, socket.user.id, viewers.length);
          // O banco guarda apenas o ultimo marco; o relogio em memoria
          // continua avancando enquanto a live permanece ativa.
          const liveState = liveStates[normalizedRoomId];

          socket.emit(
            "live-state",
            {
              id:
                activeLive.id,
              active: true,
              host:
                activeLive.host,
              currentVideoId: liveState.currentVideoId,
              currentTime: currentLiveTime(liveState),
              isPlaying: liveState.isPlaying,
              playlist:
                activeLive.playlist,
              isHost:
                activeLive.hostId ===
                socket.user.id,
            }
          );
        } else {
          socket.emit(
            "live-state",
            {
              active: false,
            }
          );
        }

        console.log(
          `${socket.user.username} entrou na sala ${normalizedRoomId} como ${membership.role}`
        );
      } catch (error) {
        console.error(
          "Erro ao entrar na sala:",
          error
        );

        socket.emit(
          "chat-error",
          {
            message:
              "Não foi possível entrar na sala.",
          }
        );
      }
    }
  );

  /*
    Enviar mensagem
  */
  socket.on(
    "chat-message",
    async (
      { roomId, message, clientKey, replyToId }
    ) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (
          !normalizedRoomId ||
          typeof message !==
            "string"
        ) {
          return;
        }

        const normalizedMessage =
          message.trim();

        if (!normalizedMessage) {
          return;
        }

        if (
          normalizedMessage.length >
          1000
        ) {
          socket.emit(
            "chat-error",
            {
              message:
                "A mensagem pode ter no máximo 1000 caracteres.",
            }
          );

          return;
        }

        if (
          !socket.rooms.has(
            normalizedRoomId
          )
        ) {
          socket.emit(
            "chat-error",
            {
              message:
                "Você não está conectado a esta sala.",
            }
          );

          return;
        }
        if (await moderation.activeSanction(normalizedRoomId, socket.user.id)) {
          socket.emit('chat-error', { message: 'Você está temporariamente silenciado nesta comunidade.' });
          return;
        }

        const safeClientKey = typeof clientKey === 'string' && /^[a-f0-9-]{36}$/i.test(clientKey)
          ? `${socket.user.id}:${clientKey}` : null;
        if (safeClientKey && await prisma.message.findUnique({ where: { clientKey: safeClientKey }, select: { id: true } })) return;
        const allowedMessage = antiSpam.allowMessage(socket.user.id, normalizedRoomId, normalizedMessage);
        if (!allowedMessage.allowed) {
          socket.emit('chat-error', { message: allowedMessage.message });
          return;
        }
        const safeReplyId = typeof replyToId === 'string' && replyToId.length < 100 ? replyToId : null;
        const mentionNames = [...normalizedMessage.matchAll(/@\{([^}\n]{3,100})\}|@([\p{L}\p{N}_]{3,100})/gu)]
          .map(match => (match[1] || match[2]).trim()).filter(Boolean);
        if (mentionNames.length > 5) {
          socket.emit('chat-error', { message: 'Use no máximo 5 menções por mensagem.' });
          return;
        }

        /*
          Salva a mensagem e concede XP
          dentro da mesma transação.
        */
        const result =
          await prisma.$transaction(
            async (transaction) => {
              if (safeReplyId && !await transaction.message.findFirst({ where: { id: safeReplyId, roomId: normalizedRoomId, deletedAt: null }, select: { id: true } })) {
                throw Object.assign(new Error('A mensagem respondida não está disponível nesta sala.'), { status: 400 });
              }
              const savedMessage =
                await transaction.message.create({
                  data: {
                    content:
                      normalizedMessage,
                    clientKey: safeClientKey,
                    roomId:
                      normalizedRoomId,
                    userId:
                      socket.user.id,
                    replyToId: safeReplyId,
                  },
                  select: chatMessages.messageSelect,
                });

              const mentioned = mentionNames.length && chatMessages.messageSelect.mentions ? await transaction.roomMember.findMany({
                where: { roomId: normalizedRoomId, userId: { not: socket.user.id },
                  user: { OR: [...new Set(mentionNames)].map(username => ({ username: { equals: username, mode: 'insensitive' } })) } },
                select: { userId: true, user: { select: { id: true, username: true } } }, take: 5,
              }) : [];
              if (mentioned.length) {
                await transaction.chatMention.createMany({ data: mentioned.map(item => ({ messageId: savedMessage.id, userId: item.userId })) });
                savedMessage.mentions = mentioned.map(item => ({ user: item.user }));
              }

              const xpResult = await reputation.messageAward(transaction, socket.user.id,
                savedMessage.id, normalizedMessage);

              const activeProjection = liveStates[normalizedRoomId];
              if (activeProjection?.active) await transaction.liveSession.updateMany({
                where: { id: activeProjection.liveId, status: 'ACTIVE' },
                data: { messageCount: { increment: 1 } },
              });

              return {
                savedMessage,
                xpResult,
              };
            },
            { maxWait: 10000, timeout: 20000 }
          );

        if (result.xpResult.realActivity) socket.realActivityAt = Date.now();

        emitXpToUser(socket.user.id, result.xpResult, "MESSAGE_SENT");
        if (result.xpResult.gainedXp) void gamification.syncAchievements(socket.user.id, io)
          .catch(error => console.error('Falha ao conferir conquistas:', error));

        const messageData = chatMessages.format(result.savedMessage);
        messageData.user.level = result.xpResult.user.level;
        messageData.user.title = reputation.progress(result.xpResult.user.xp).title;

        io.to(
          normalizedRoomId
        ).emit(
          "chat-message",
          messageData
        );
        for (const mention of messageData.mentions || []) io.to(`user:${mention.id}`).emit('chat-mention', {
          roomId: normalizedRoomId, messageId: messageData.id, from: socket.user.username,
        });
        void publishChatNotifications(result.savedMessage, normalizedRoomId, socket.user)
          .catch(error => console.error('Erro ao notificar mensagem do chat:', error));
      } catch (error) {
        if (error?.code === 'P2002') return;
        console.error(
          "Erro ao salvar mensagem:",
          error
        );

        socket.emit(
          "chat-error",
          {
            message: error.status ? error.message : "Não foi possível enviar a mensagem.",
          }
        );
      }
    }
  );

  socket.on('chat-media-message', async ({ roomId, type, mediaId, stickerId, replyToId, clientKey } = {}, callback) => {
    try {
      const id = normalizeRoomId(roomId);
      if (!socket.rooms.has(id) || !['AUDIO', 'STICKER'].includes(type)) throw new Error('Entre na sala para enviar esta mensagem.');
      if (await moderation.activeSanction(id, socket.user.id)) throw new Error('Você está temporariamente silenciado nesta comunidade.');
      const safeKey = typeof clientKey === 'string' && /^[a-f0-9-]{36}$/i.test(clientKey) ? `${socket.user.id}:${clientKey}` : null;
      if (!safeKey) throw new Error('Identificador de mensagem inválido.');
      const existing = await prisma.message.findUnique({ where: { clientKey: safeKey }, select: { id: true } });
      if (existing) return callback?.({ success: true, id: existing.id, duplicate: true });
      const allowedMedia = antiSpam.allowMessage(socket.user.id, id, `${type}:${type === 'AUDIO' ? mediaId : stickerId}`);
      if (!allowedMedia.allowed) throw new Error(allowedMedia.message);
      let assetId;
      if (type === 'AUDIO') {
        const asset = await prisma.chatAsset.findFirst({ where: { id: mediaId, kind: 'AUDIO', ownerId: socket.user.id,
          roomId: id, createdAt: { gte: new Date(Date.now() - 86400000) }, messages: { none: {} } }, select: { id: true } });
        if (!asset) throw new Error('Áudio indisponível ou já enviado.');
        assetId = asset.id;
      } else {
        const sticker = await prisma.sticker.findFirst({ where: { id: stickerId, ownerId: socket.user.id }, select: { assetId: true } });
        if (!sticker) throw new Error('Figurinha indisponível.');
        assetId = sticker.assetId;
      }
      const recent = await prisma.message.count({ where: { userId: socket.user.id,
        createdAt: { gte: new Date(Date.now() - 60000) } } });
      if (recent >= 30) throw new Error('Aguarde antes de enviar mais mensagens.');
      const saved = await prisma.$transaction(async tx => {
        if (type === 'AUDIO') {
          await tx.$queryRaw`SELECT id FROM "ChatAsset" WHERE id = ${assetId} FOR UPDATE`;
          if (await tx.message.findFirst({ where: { mediaId: assetId }, select: { id: true } })) {
            throw new Error('Este áudio já foi enviado.');
          }
        }
        const parentId = typeof replyToId === 'string' ? replyToId : null;
        if (parentId && !await tx.message.findFirst({ where: { id: parentId, roomId: id, deletedAt: null }, select: { id: true } })) {
          throw new Error('A mensagem respondida não está disponível nesta sala.');
        }
        const row = await tx.message.create({ data: { content: '', type, mediaId: assetId,
          roomId: id, userId: socket.user.id, clientKey: safeKey, replyToId: parentId }, select: chatMessages.messageSelect });
        const active = liveStates[id];
        if (active?.active) await tx.liveSession.updateMany({ where: { id: active.liveId, status: 'ACTIVE' },
          data: { messageCount: { increment: 1 } } });
        return row;
      });
      io.to(id).emit('chat-message', chatMessages.format(saved));
      void publishChatNotifications(saved, id, socket.user)
        .catch(error => console.error('Erro ao notificar resposta do chat:', error));
      callback?.({ success: true, id: saved.id });
    } catch (error) {
      if (error?.code === 'P2002') return callback?.({ success: true, duplicate: true });
      callback?.({ success: false, message: error.message || 'Não foi possível enviar a mensagem.' });
    }
  });

  /*
    Iniciar live
  */
  socket.on(
    "live-start",
    async (
      { roomId },
      callback
    ) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (!normalizedRoomId) {
          return callback?.({
            success: false,
            message:
              "Sala inválida.",
          });
        }

        if (
          !socket.rooms.has(
            normalizedRoomId
          )
        ) {
          return callback?.({
            success: false,
            message:
              "Você não está conectado a esta sala.",
          });
        }

        const membership =
          await prisma.roomMember.findUnique({
            where: {
              userId_roomId: {
                userId:
                  socket.user.id,
                roomId:
                  normalizedRoomId,
              },
            },
          });

        const canStartLive =
          socket.user.isSiteAdmin ||
          membership?.role ===
            "OWNER" ||
          membership?.role ===
            "CO_ADMIN";

        if (!canStartLive) {
          return callback?.({
            success: false,
            message:
              "Somente administradores podem iniciar uma live.",
          });
        }

        const existingLive =
          await prisma.liveSession.findFirst({
            where: {
              roomId:
                normalizedRoomId,
              status: "ACTIVE",
            },
          });

        if (existingLive) {
          return callback?.({
            success: false,
            message:
              "Já existe uma live ativa nesta sala.",
          });
        }

        const live =
          await prisma.liveSession.create({
            data: {
              roomId:
                normalizedRoomId,
              hostId:
                socket.user.id,
              roomName: (await prisma.room.findUnique({ where: { id: normalizedRoomId }, select: { name: true } })).name,
              repTickAt: new Date(),
            },
            select: {
              id: true,
              roomId: true,
              hostId: true,
              roomName: true,
              startedAt: true,
            },
          });

        liveStates[
          normalizedRoomId
        ] = {
          liveId: live.id,
          active: true,
          hostId:
            socket.user.id,
          currentVideoId: null,
          currentTime: 0,
          isPlaying: false,
          timeUpdatedAt: Date.now(),
          playlist: [],
        };

        const liveData = {
          id: live.id,
          active: true,
          host: {
            id: socket.user.id,
            username:
              socket.user.username,
            avatar:
              socket.user.avatar,
          },
          currentVideoId: null,
          currentTime: 0,
          isPlaying: false,
          playlist: [],
          startedAt:
            live.startedAt.toISOString(),
        };

        io.to(
          normalizedRoomId
        ).emit(
          "live-started",
          liveData
        );
        void publishProjectionStart(live.id, normalizedRoomId, live.roomName, socket.user)
          .catch(error => console.error('Erro ao notificar projeção:', error));

        return callback?.({
          success: true,
          liveId: live.id,
        });
      } catch (error) {
        console.error(
          "Erro ao iniciar live:",
          error
        );

        return callback?.({
          success: false,
          message:
            "Não foi possível iniciar a live.",
        });
      }
    }
  );

  /*
    Adicionar vídeo à playlist
  */
  socket.on('projection-confirm', async ({ roomId } = {}, callback) => {
    try {
      const id = normalizeRoomId(roomId);
      const live = liveStates[id];
      if (!live?.active || !socket.rooms.has(id) || live.hostId === socket.user.id) {
        return callback?.({ success: false, message: 'Entre em uma projeção ativa para confirmar presença.' });
      }
      const confirmedAt = await projectionRep.confirmViewer(live.liveId, socket.user.id);
      callback?.({ success: Boolean(confirmedAt), confirmedAt: confirmedAt?.toISOString(),
        message: confirmedAt ? undefined : 'Não foi possível confirmar sua presença.' });
    } catch (error) {
      console.error('Erro ao confirmar presença na projeção:', error);
      callback?.({ success: false, message: 'Não foi possível confirmar sua presença.' });
    }
  });

  socket.on(
    "playlist-add",
    async (
      {
        roomId,
        videoId,
        title,
      },
      callback
    ) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        const normalizedVideoId =
          typeof videoId ===
          "string"
            ? videoId.trim()
            : "";

        if (
          !normalizedRoomId ||
          !normalizedVideoId
        ) {
          return callback?.({
            success: false,
            message:
              "Vídeo inválido.",
          });
        }

        if (
          !socket.rooms.has(normalizedRoomId) || !isLiveHost(
            normalizedRoomId,
            socket.user.id
          )
        ) {
          return callback?.({
            success: false,
            message:
              "Somente quem iniciou a live pode adicionar vídeos.",
          });
        }

        const liveState =
          liveStates[
            normalizedRoomId
          ];

        const existingVideo =
          await prisma.playlistItem.findFirst({
            where: {
              liveId:
                liveState.liveId,
              videoId:
                normalizedVideoId,
              status: {
                in: [
                  "WAITING",
                  "PLAYING",
                ],
              },
            },
          });

        if (existingVideo) {
          return callback?.({
            success: false,
            message:
              "Esse vídeo já está na playlist.",
          });
        }

        const lastItem =
          await prisma.playlistItem.findFirst({
            where: {
              liveId:
                liveState.liveId,
            },
            orderBy: {
              position: "desc",
            },
          });

        const nextPosition =
          lastItem
            ? lastItem.position + 1
            : 1;

        const playlistItem =
          await prisma.playlistItem.create({
            data: {
              liveId:
                liveState.liveId,
              addedById:
                socket.user.id,
              videoId:
                normalizedVideoId,
              title:
                typeof title ===
                "string"
                  ? title
                      .trim()
                      .slice(
                        0,
                        200
                      ) || null
                  : null,
              position:
                nextPosition,
            },
          });

        await emitUpdatedPlaylist(
          normalizedRoomId
        );

        if (
          !liveState.currentVideoId
        ) {
          await playNextVideo(
            normalizedRoomId
          );
        }

        return callback?.({
          success: true,
          item:
            playlistItem,
        });
      } catch (error) {
        console.error(
          "Erro ao adicionar vídeo:",
          error
        );

        return callback?.({
          success: false,
          message:
            "Não foi possível adicionar o vídeo.",
        });
      }
    }
  );

  /*
    Avançar manualmente
  */
  socket.on(
    "playlist-next",
    async (
      { roomId },
      callback
    ) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (
          !isLiveHost(
            normalizedRoomId,
            socket.user.id
          )
        ) {
          return callback?.({
            success: false,
            message:
              "Você não controla esta live.",
          });
        }

        const result =
          await playNextVideo(
            normalizedRoomId
          );

        return callback?.(
          result
        );
      } catch (error) {
        console.error(
          "Erro ao avançar vídeo:",
          error
        );

        return callback?.({
          success: false,
          message:
            "Não foi possível avançar o vídeo.",
        });
      }
    }
  );

  /*
    O player informa que o vídeo acabou.
  */
  socket.on(
    "video-ended",
    async (
      { roomId },
      callback
    ) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (
          !isLiveHost(
            normalizedRoomId,
            socket.user.id
          )
        ) {
          return callback?.({
            success: false,
            message:
              "Você não controla esta live.",
          });
        }

        const result =
          await playNextVideo(
            normalizedRoomId
          );

        return callback?.(
          result
        );
      } catch (error) {
        console.error(
          "Erro ao finalizar vídeo:",
          error
        );

        return callback?.({
          success: false,
          message:
            "Não foi possível carregar o próximo vídeo.",
        });
      }
    }
  );

  /*
    Play controlado pelo host
  */
  socket.on(
    "video-play",
    async ({
      roomId,
      currentTime,
    }) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (
          !socket.rooms.has(normalizedRoomId) || !isLiveHost(
            normalizedRoomId,
            socket.user.id
          )
        ) {
          return;
        }

        const liveState =
          liveStates[
            normalizedRoomId
          ];

        if (
          !liveState.currentVideoId
        ) {
          return;
        }

        await settleProjection(normalizedRoomId);
        setLiveClock(liveState, currentTime, true);

        await prisma.liveSession.update({
          where: {
            id:
              liveState.liveId,
          },
          data: {
            isPlaying: true,
            currentTime:
              liveState.currentTime,
          },
        });

        io.to(normalizedRoomId).emit("video-sync", liveSyncSnapshot(liveState));
      } catch (error) {
        console.error(
          "Erro ao reproduzir vídeo:",
          error
        );
      }
    }
  );

  /*
    Pause controlado pelo host
  */
  socket.on(
    "video-pause",
    async ({
      roomId,
      currentTime,
    }) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (
          !socket.rooms.has(normalizedRoomId) || !isLiveHost(
            normalizedRoomId,
            socket.user.id
          )
        ) {
          return;
        }

        const liveState =
          liveStates[
            normalizedRoomId
          ];

        if (
          !liveState.currentVideoId
        ) {
          return;
        }

        await settleProjection(normalizedRoomId);
        setLiveClock(liveState, currentTime, false);

        await prisma.liveSession.update({
          where: {
            id:
              liveState.liveId,
          },
          data: {
            isPlaying: false,
            currentTime:
              liveState.currentTime,
          },
        });

        io.to(normalizedRoomId).emit("video-sync", liveSyncSnapshot(liveState));
      } catch (error) {
        console.error(
          "Erro ao pausar vídeo:",
          error
        );
      }
    }
  );

  /*
    Atualização de tempo.
    Somente o host atualiza o estado.
  */
  socket.on(
    "video-time-update",
    async ({
      roomId,
      currentTime,
    }) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (
          !socket.rooms.has(normalizedRoomId) || !isLiveHost(
            normalizedRoomId,
            socket.user.id
          )
        ) {
          return;
        }

        const liveState =
          liveStates[
            normalizedRoomId
          ];

        const normalizedTime = Number(currentTime);
        if (!liveState?.currentVideoId || !liveState.isPlaying || !Number.isFinite(normalizedTime)) return;
        setLiveClock(liveState, normalizedTime, true);
        io.to(normalizedRoomId).emit("video-sync", liveSyncSnapshot(liveState));

        /*
          Salva apenas no estado em memória.
          Evita muitas gravações no Neon.
        */
      } catch (error) {
        console.error(
          "Erro ao atualizar tempo:",
          error
        );
      }
    }
  );

  socket.on("video-sync-request", ({ roomId }, callback) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    const liveState = liveStates[normalizedRoomId];
    if (!socket.rooms.has(normalizedRoomId) || !liveState?.active) {
      return callback?.({ success: false });
    }
    callback?.({ success: true, ...liveSyncSnapshot(liveState) });
  });

  /*
    Encerrar live
  */
  socket.on(
    "live-end",
    async (
      { roomId },
      callback
    ) => {
      try {
        const normalizedRoomId =
          normalizeRoomId(roomId);

        if (
          !isLiveHost(
            normalizedRoomId,
            socket.user.id
          )
        ) {
          return callback?.({
            success: false,
            message:
              "Você não controla esta live.",
          });
        }

        await endLiveSession(normalizedRoomId);

        return callback?.({
          success: true,
        });
      } catch (error) {
        console.error(
          "Erro ao encerrar live:",
          error
        );

        return callback?.({
          success: false,
          message:
            "Não foi possível encerrar a live.",
        });
      }
    }
  );

  socket.on(
    "disconnecting",
    () => {
      const roomIds = [...socket.rooms].filter((roomId) => roomId !== socket.id &&
        !roomId.startsWith('user:') && !roomId.startsWith('voice:'));
      for (const roomId of roomIds) if (liveStates[roomId]) settleProjection(roomId)
        .catch(error => console.error('Erro ao registrar saída da projeção:', error));
      setImmediate(() => roomIds.forEach((roomId) => {
        emitRoomPresence(roomId);
        const liveId = liveStates[roomId]?.liveId;
        if (liveId && ![...io.sockets.sockets.values()].some(peer => peer.user?.id === socket.user.id && peer.rooms.has(roomId))) {
          projectionRep.recordLeave(liveId, socket.user.id)
            .catch(error => console.error('Erro ao registrar visitante da projeção:', error));
        }
        endLiveWhenRoomEmpty(roomId);
      }));
    }
  );

  socket.on(
    "disconnect",
    () => {
      console.log(
        `Usuário desconectado: ${socket.user.username} (${socket.id})`
      );
    }
  );
});

// Somente mensagens válidas observadas pelo servidor iniciam atividade.
// O estado persistido e o bloqueio por usuário impedem multiplicação por abas.
setInterval(async () => {
  const connected = new Map();
  for (const socket of io.sockets.sockets.values())
    if (socket.user?.id && socket.realActivityAt && Date.now() - socket.realActivityAt <= 180000)
      connected.set(socket.user.id, socket);
  for (const [userId, socket] of connected) {
    try {
      const result = await reputation.presenceAward(userId);
      if (result?.gainedXp) {
        emitXpToUser(userId, result, 'CHAT_PRESENCE');
      }
    } catch (error) { console.error('Erro ao conceder XP de presença:', error); }
  }
}, 30000).unref();

const PORT =
  process.env.PORT || 3000;

async function startServer() {
  try {
    await prisma.chatMention.count();
  } catch (error) {
    if (error.code === 'P2021') {
      // Mantém o histórico e o envio de mensagens disponíveis até a migração ser aplicada.
      delete chatMessages.messageSelect.mentions;
      console.warn('Migração de menções pendente; chat iniciado sem notificações de menção.');
    } else console.error('Erro ao verificar migração de menções:', error);
  }
  try {
    const orphaned = await prisma.liveSession.findMany({ where: { status: 'ACTIVE' }, select: { roomId: true } });
    for (const live of orphaned) await endLiveSession(live.roomId);
  } catch (error) { console.error('Erro ao encerrar projeções interrompidas:', error); }
  server.listen(PORT, '0.0.0.0', () => console.log(`🔥 Servidor rodando na porta ${PORT}`));
}
startServer();
