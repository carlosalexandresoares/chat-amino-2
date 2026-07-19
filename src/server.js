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
  socket.on("join-room", (roomId) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        videoId: null,
        isPlaying: false,
        currentTime: 0,
      };
    }

    socket.emit("sync-state", rooms[roomId]);
  });

  // CHAT (sem duplicar: envia só para os outros)
  socket.on("chat-message", ({ roomId, message }) => {
  if (!roomId || !message?.trim()) {
    return;
  }

  const messageData = {
    id: crypto.randomUUID(),
    user: {
      id: socket.user.id,
      username: socket.user.username,
      avatar: socket.user.avatar,
      level: socket.user.level,
    },
    message: message.trim(),
    createdAt: new Date().toISOString(),
  };

  io.to(roomId).emit("chat-message", messageData);
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
