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

const app = express();

app.use(cors());
app.use(express.json());

// Servir o frontend da pasta public
app.use(express.static(path.join(__dirname, "../public")));

// Rotas de autenticação
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api", socialRoutes);

// Health check do Render
app.get("/healthz", (req, res) => {
  return res.status(200).json({
    status: "ok",
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});
app.set("io", io);

function emitRoomPresence(roomId) {
  const users = new Set();
  for (const socketId of io.sockets.adapter.rooms.get(roomId) || []) {
    const userId = io.sockets.sockets.get(socketId)?.user?.id;
    if (userId) users.add(userId);
  }
  io.to(roomId).emit("room-presence", { roomId, onlineCount: users.size });
}

/*
  Regras de XP
*/
const XP_PER_MESSAGE = 2;
const XP_DAILY_LOGIN = 10;
const XP_PER_LEVEL = 100;

/*
  Estado temporário das lives.

  O banco mantém os dados permanentes.
  Este objeto mantém a sincronização rápida
  enquanto o servidor está ligado.
*/
const liveStates = {};
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
    select: { id: true, currentTime: true },
  });
  if (!live) {
    delete liveStates[roomId];
    return false;
  }

  await prisma.$transaction([
    prisma.liveSession.update({
      where: { id: live.id },
      data: {
        status: "ENDED",
        endedAt: new Date(),
        isPlaying: false,
        currentTime: liveStates[roomId] ? currentLiveTime(liveStates[roomId]) : live.currentTime,
      },
    }),
    prisma.playlistItem.updateMany({
      where: { liveId: live.id, status: { in: ["WAITING", "PLAYING"] } },
      data: { status: "REMOVED" },
    }),
  ]);
  delete liveStates[roomId];
  io.to(roomId).emit("live-ended");
  return true;
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
 * Calcula o nível usando o XP total.
 *
 * 0 até 99 XP = nível 1
 * 100 até 199 XP = nível 2
 * 200 até 299 XP = nível 3
 */
function calculateLevel(xp) {
  const normalizedXp = Math.max(
    0,
    Number(xp) || 0
  );

  return (
    Math.floor(
      normalizedXp / XP_PER_LEVEL
    ) + 1
  );
}

/**
 * Retorna o início do dia atual em UTC.
 *
 * Esse valor é usado para impedir que o
 * bônus diário seja recebido mais de uma
 * vez no mesmo dia.
 */
function getStartOfCurrentUtcDay() {
  const now = new Date();

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
}

/**
 * Concede uma quantidade de XP ao usuário.
 *
 * Pode receber o Prisma normal ou o cliente
 * de uma transação.
 */
async function grantXp(
  databaseClient,
  userId,
  amount
) {
  const normalizedAmount = Math.max(
    0,
    Number(amount) || 0
  );

  if (!normalizedAmount) {
    const user =
      await databaseClient.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          username: true,
          avatar: true,
          xp: true,
          level: true,
        },
      });

    return {
      user,
      gainedXp: 0,
      previousLevel:
        user?.level || 1,
      leveledUp: false,
    };
  }

  /*
    O increment evita perder XP caso duas
    ações aconteçam quase ao mesmo tempo.
  */
  const userWithNewXp =
    await databaseClient.user.update({
      where: {
        id: userId,
      },
      data: {
        xp: {
          increment: normalizedAmount,
        },
      },
      select: {
        id: true,
        username: true,
        avatar: true,
        xp: true,
        level: true,
      },
    });

  const previousLevel =
    userWithNewXp.level;

  const newLevel = calculateLevel(
    userWithNewXp.xp
  );

  let updatedUser = userWithNewXp;

  if (
    newLevel !== userWithNewXp.level
  ) {
    updatedUser =
      await databaseClient.user.update({
        where: {
          id: userId,
        },
        data: {
          level: newLevel,
        },
        select: {
          id: true,
          username: true,
          avatar: true,
          xp: true,
          level: true,
        },
      });
  }

  return {
    user: updatedUser,
    gainedXp: normalizedAmount,
    previousLevel,
    leveledUp:
      updatedUser.level > previousLevel,
  };
}

/**
 * Tenta conceder o bônus diário.
 *
 * O updateMany garante que somente uma
 * conexão por dia consiga alterar o XP.
 */
async function claimDailyXp(userId) {
  const now = new Date();

  const startOfToday =
    getStartOfCurrentUtcDay();

  const dailyUpdate =
    await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [
          {
            lastDailyXpAt: null,
          },
          {
            lastDailyXpAt: {
              lt: startOfToday,
            },
          },
        ],
      },
      data: {
        xp: {
          increment: XP_DAILY_LOGIN,
        },
        lastDailyXpAt: now,
      },
    });

  const userAfterDailyXp =
    await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        username: true,
        avatar: true,
        xp: true,
        level: true,
        lastDailyXpAt: true,
      },
    });

  if (!userAfterDailyXp) {
    return {
      user: null,
      gainedXp: 0,
      previousLevel: 1,
      leveledUp: false,
      granted: false,
    };
  }

  const previousLevel =
    userAfterDailyXp.level;

  const calculatedLevel =
    calculateLevel(
      userAfterDailyXp.xp
    );

  let updatedUser =
    userAfterDailyXp;

  if (
    calculatedLevel !==
    userAfterDailyXp.level
  ) {
    updatedUser =
      await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          level: calculatedLevel,
        },
        select: {
          id: true,
          username: true,
          avatar: true,
          xp: true,
          level: true,
          lastDailyXpAt: true,
        },
      });
  }

  const granted =
    dailyUpdate.count === 1;

  return {
    user: updatedUser,
    gainedXp:
      granted
        ? XP_DAILY_LOGIN
        : 0,
    previousLevel,
    leveledUp:
      granted &&
      updatedUser.level >
        previousLevel,
    granted,
  };
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
    nextLevelXp:
      xpResult.user.level *
      XP_PER_LEVEL,
  });

  if (xpResult.leveledUp) {
    socket.emit("level-up", {
      previousLevel:
        xpResult.previousLevel,
      level:
        xpResult.user.level,
      xp:
        xpResult.user.xp,
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
    const dailyXpResult =
      await claimDailyXp(
        existingUser.id
      );

    if (!dailyXpResult.user) {
      return next(
        new Error(
          "Usuário não encontrado."
        )
      );
    }

    socket.user =
      dailyXpResult.user;

    socket.dailyXpResult =
      dailyXpResult;

    return next();
  } catch (error) {
    console.error(
      "Erro de autenticação do Socket.IO:",
      error.message
    );

    return next(
      new Error(
        "Token inválido ou expirado."
      )
    );
  }
});

io.on("connection", (socket) => {
  console.log(
    `Usuário conectado: ${socket.user.username} (${socket.id})`
  );

  /*
    Informa o bônus diário depois que
    a conexão do socket foi concluída.
  */
  if (
    socket.dailyXpResult?.granted
  ) {
    emitXpResult(
      socket,
      socket.dailyXpResult,
      "DAILY_LOGIN"
    );
  }

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
              membership.role,
            canStartLive:
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
            take: 100,
            select: {
              id: true,
              content: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  avatar: true,
                  level: true,
                },
              },
            },
          });

        const formattedHistory =
          history
            .reverse()
            .map((message) => ({
              id: message.id,
              user: {
                id:
                  message.user.id,
                username:
                  message.user.username,
                avatar:
                  message.user.avatar,
                level:
                  message.user.level,
              },
              message:
                message.content,
              createdAt:
                message.createdAt.toISOString(),
            }));

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
      { roomId, message }
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

        /*
          Salva a mensagem e concede XP
          dentro da mesma transação.
        */
        const result =
          await prisma.$transaction(
            async (transaction) => {
              const savedMessage =
                await transaction.message.create({
                  data: {
                    content:
                      normalizedMessage,
                    roomId:
                      normalizedRoomId,
                    userId:
                      socket.user.id,
                  },
                  select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    user: {
                      select: {
                        id: true,
                        username: true,
                        avatar: true,
                      },
                    },
                  },
                });

              const xpResult =
                await grantXp(
                  transaction,
                  socket.user.id,
                  XP_PER_MESSAGE
                );

              return {
                savedMessage,
                xpResult,
              };
            }
          );

        updateSocketUser(
          socket,
          result.xpResult.user
        );

        emitXpResult(
          socket,
          result.xpResult,
          "MESSAGE_SENT"
        );

        const messageData = {
          id:
            result.savedMessage.id,
          user: {
            id:
              result.savedMessage.user.id,
            username:
              result.savedMessage.user
                .username,
            avatar:
              result.savedMessage.user
                .avatar,
            level:
              result.xpResult.user.level,
          },
          message:
            result.savedMessage.content,
          createdAt:
            result.savedMessage.createdAt.toISOString(),
        };

        io.to(
          normalizedRoomId
        ).emit(
          "chat-message",
          messageData
        );
      } catch (error) {
        console.error(
          "Erro ao salvar mensagem:",
          error
        );

        socket.emit(
          "chat-error",
          {
            message:
              "Não foi possível enviar a mensagem.",
          }
        );
      }
    }
  );

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
            },
            select: {
              id: true,
              roomId: true,
              hostId: true,
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
      const roomIds = [...socket.rooms].filter((roomId) => roomId !== socket.id);
      setImmediate(() => roomIds.forEach((roomId) => {
        emitRoomPresence(roomId);
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

const PORT =
  process.env.PORT || 3000;

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🔥 Servidor rodando na porta ${PORT}`
    );
  }
);
