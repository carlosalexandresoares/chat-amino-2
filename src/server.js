require("dotenv").config();

const crypto = require("crypto");
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


// SERVIR FRONTEND (public está fora de src)
app.use(express.static(path.join(__dirname, "../public")));
app.use("/api/auth", authRoutes);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Token não informado."));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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
      return next(new Error("Usuário não encontrado."));
    }

    socket.user = user;

    return next();
  } catch (error) {
    console.error("Erro de autenticação do Socket.IO:", error.message);

    return next(new Error("Token inválido ou expirado."));
  }
});


io.on("connection", (socket) => {
  console.log(
    `Usuário conectado: ${socket.user.username} (${socket.id})`
  );
  
  const rooms = {};
 socket.on("join-room", async (roomId) => {
  try {
    if (
      typeof roomId !== "string" ||
      !roomId.trim() ||
      roomId.length > 50
    ) {
      return;
    }

    const normalizedRoomId = roomId.trim().toLowerCase();

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

    const history = await prisma.message.findMany({
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
        createdAt: message.createdAt.toISOString(),
      }));

    socket.emit("chat-history", formattedHistory);
    socket.emit("sync-state", rooms[normalizedRoomId]);

    console.log(
      `${socket.user.username} entrou na sala ${normalizedRoomId}`
    );
  } catch (error) {
    console.error("Erro ao entrar na sala:", error);

    socket.emit("chat-error", {
      message: "Não foi possível entrar na sala.",
    });
  }
});

  // CHAT (sem duplicar: envia só para os outros)
socket.on("chat-message", async ({ roomId, message }) => {
  try {
    if (
      typeof roomId !== "string" ||
      typeof message !== "string"
    ) {
      return;
    }

    const normalizedRoomId = roomId.trim().toLowerCase();
    const normalizedMessage = message.trim();

    if (!normalizedRoomId || !normalizedMessage) {
      return;
    }

    if (normalizedMessage.length > 1000) {
      socket.emit("chat-error", {
        message: "A mensagem pode ter no máximo 1000 caracteres.",
      });

      return;
    }

    if (!socket.rooms.has(normalizedRoomId)) {
      socket.emit("chat-error", {
        message: "Você não está conectado a esta sala.",
      });

      return;
    }

    const savedMessage = await prisma.message.create({
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
        username: savedMessage.user.username,
        avatar: savedMessage.user.avatar,
        level: savedMessage.user.level,
      },
      message: savedMessage.content,
      createdAt: savedMessage.createdAt.toISOString(),
    };

    io.to(normalizedRoomId).emit(
      "chat-message",
      messageData
    );
  } catch (error) {
    console.error("Erro ao salvar mensagem:", error);

    socket.emit("chat-error", {
      message: "Não foi possível enviar a mensagem.",
    });
  }
});



  // ABRIR VIDEO (aqui envia para TODOS)
  socket.on("open-video", ({ roomId, videoId }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].videoId = videoId;
    rooms[roomId].isPlaying = true;
    rooms[roomId].currentTime = 0;

   io.to(roomId).emit("open-video", videoId);

  });

  socket.on("video-play", ({ roomId, currentTime }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].isPlaying = true;
    rooms[roomId].currentTime = currentTime;

    io.to(roomId).emit("video-play", currentTime);
  });

  socket.on("video-pause", ({ roomId, currentTime }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].isPlaying = false;
    rooms[roomId].currentTime = currentTime;

    io.to(roomId).emit("video-pause", currentTime);
  });

  socket.on("video-time-update", ({ roomId, currentTime }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].currentTime = currentTime;
  });

  socket.on("disconnect", () => {
    console.log("Usuário desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🔥 Servidor rodando na porta ${PORT}`));
