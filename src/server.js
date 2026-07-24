require("dotenv").config();

const jwt = require("jsonwebtoken");
const prisma = require("./database/prisma");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const authRoutes = require("./routes/authRoutes");

const app = express();

app.use(cors());
app.use(express.json());

// Servir o frontend da pasta public
app.use(express.static(path.join(__dirname, "../public")));

// Rotas de autenticação
app.use("/api/auth", authRoutes);

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

// Estado das salas compartilhado por todas as conexões
const rooms = {};

// Autenticação do Socket.IO
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Token não informado."));
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET não está configurado.");

      return next(
        new Error("Erro na configuração do servidor.")
      );
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.sub,
      },
      select: {
        id: true,
        username: true,
        avatar: true,
        level: true,
        xp: true,
      },
    });

    if (!user) {
      return next(
        new Error("Usuário não encontrado.")
      );
    }

    socket.user = user;

    return next();
  } catch (error) {
    console.error(
      "Erro de autenticação do Socket.IO:",
      error.message
    );

    return next(
      new Error("Token inválido ou expirado.")
    );
  }
});

io.on("connection", (socket) => {
  console.log(
    `Usuário conectado: ${socket.user.username} (${socket.id})`
  );

  socket.on("join-room", async (roomId) => {
    try {
      if (
        typeof roomId !== "string" ||
        !roomId.trim() ||
        roomId.length > 50
      ) {
        return;
      }

      const normalizedRoomId = roomId
        .trim()
        .toLowerCase();

      await prisma.room.upsert({
        where: {
          id: normalizedRoomId,
        },
        update: {},
        create: {
          id: normalizedRoomId,
          name:
            normalizedRoomId === "geral"
              ? "Sala Geral"
              : normalizedRoomId,
        },
      });

      socket.join(normalizedRoomId);

      if (!rooms[normalizedRoomId]) {
        rooms[normalizedRoomId] = {
          videoId: null,
          isPlaying: false,
          currentTime: 0,
        };
      }

      const history =
        await prisma.message.findMany({
          where: {
            roomId: normalizedRoomId,
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

      const formattedHistory = history
        .reverse()
        .map((message) => ({
          id: message.id,
          user: {
            id: message.user.id,
            username: message.user.username,
            avatar: message.user.avatar,
            level: message.user.level,
          },
          message: message.content,
          createdAt:
            message.createdAt.toISOString(),
        }));

      socket.emit(
        "chat-history",
        formattedHistory
      );

      socket.emit(
        "sync-state",
        rooms[normalizedRoomId]
      );

      console.log(
        `${socket.user.username} entrou na sala ${normalizedRoomId}`
      );
    } catch (error) {
      console.error(
        "Erro ao entrar na sala:",
        error
      );

      socket.emit("chat-error", {
        message:
          "Não foi possível entrar na sala.",
      });
    }
  });

  socket.on(
    "chat-message",
    async ({ roomId, message }) => {
      try {
        if (
          typeof roomId !== "string" ||
          typeof message !== "string"
        ) {
          return;
        }

        const normalizedRoomId = roomId
          .trim()
          .toLowerCase();

        const normalizedMessage =
          message.trim();

        if (
          !normalizedRoomId ||
          !normalizedMessage
        ) {
          return;
        }

        if (normalizedMessage.length > 1000) {
          socket.emit("chat-error", {
            message:
              "A mensagem pode ter no máximo 1000 caracteres.",
          });

          return;
        }

        if (
          !socket.rooms.has(
            normalizedRoomId
          )
        ) {
          socket.emit("chat-error", {
            message:
              "Você não está conectado a esta sala.",
          });

          return;
        }

        const savedMessage =
          await prisma.message.create({
            data: {
              content: normalizedMessage,
              roomId: normalizedRoomId,
              userId: socket.user.id,
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
                  level: true,
                },
              },
            },
          });

        const messageData = {
          id: savedMessage.id,
          user: {
            id: savedMessage.user.id,
            username:
              savedMessage.user.username,
            avatar:
              savedMessage.user.avatar,
            level:
              savedMessage.user.level,
          },
          message:
            savedMessage.content,
          createdAt:
            savedMessage.createdAt.toISOString(),
        };

        io.to(normalizedRoomId).emit(
          "chat-message",
          messageData
        );
      } catch (error) {
        console.error(
          "Erro ao salvar mensagem:",
          error
        );

        socket.emit("chat-error", {
          message:
            "Não foi possível enviar a mensagem.",
        });
      }
    }
  );

  socket.on(
    "open-video",
    ({ roomId, videoId }) => {
      if (
        typeof roomId !== "string" ||
        typeof videoId !== "string"
      ) {
        return;
      }

      const normalizedRoomId = roomId
        .trim()
        .toLowerCase();

      if (!rooms[normalizedRoomId]) {
        return;
      }

      rooms[normalizedRoomId].videoId =
        videoId;

      rooms[normalizedRoomId].isPlaying =
        true;

      rooms[normalizedRoomId].currentTime =
        0;

      io.to(normalizedRoomId).emit(
        "open-video",
        videoId
      );
    }
  );

  socket.on(
    "video-play",
    ({ roomId, currentTime }) => {
      if (typeof roomId !== "string") {
        return;
      }

      const normalizedRoomId = roomId
        .trim()
        .toLowerCase();

      if (!rooms[normalizedRoomId]) {
        return;
      }

      rooms[normalizedRoomId].isPlaying =
        true;

      rooms[normalizedRoomId].currentTime =
        Number(currentTime) || 0;

      io.to(normalizedRoomId).emit(
        "video-play",
        rooms[normalizedRoomId].currentTime
      );
    }
  );

  socket.on(
    "video-pause",
    ({ roomId, currentTime }) => {
      if (typeof roomId !== "string") {
        return;
      }

      const normalizedRoomId = roomId
        .trim()
        .toLowerCase();

      if (!rooms[normalizedRoomId]) {
        return;
      }

      rooms[normalizedRoomId].isPlaying =
        false;

      rooms[normalizedRoomId].currentTime =
        Number(currentTime) || 0;

      io.to(normalizedRoomId).emit(
        "video-pause",
        rooms[normalizedRoomId].currentTime
      );
    }
  );

  socket.on(
    "video-time-update",
    ({ roomId, currentTime }) => {
      if (typeof roomId !== "string") {
        return;
      }

      const normalizedRoomId = roomId
        .trim()
        .toLowerCase();

      if (!rooms[normalizedRoomId]) {
        return;
      }

      rooms[normalizedRoomId].currentTime =
        Number(currentTime) || 0;
    }
  );

  socket.on("disconnect", () => {
    console.log(
      `Usuário desconectado: ${socket.user.username} (${socket.id})`
    );
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🔥 Servidor rodando na porta ${PORT}`
  );
});