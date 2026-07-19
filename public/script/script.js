let isSyncing = false;

/* ================= AUTENTICAÇÃO ================= */

const token = localStorage.getItem("authToken");

if (!token) {
  window.location.href = "/login.html";
}

let currentUser = null;

const socket = io({
  autoConnect: false,

  auth: {
    token,
  },
});

async function loadAuthenticatedUser() {
  try {
    const response = await fetch("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    console.log("Resposta /api/auth/me:", response.status, data);

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem("authToken");
      window.location.href = "/login.html";
      return;
    }

    if (!response.ok) {
      throw new Error(
        data.message || "Não foi possível carregar o usuário."
      );
    }

    currentUser = data.user;

    console.log("Usuário autenticado:", currentUser);

    socket.connect();
  } catch (error) {
    console.error("Erro ao carregar usuário:", error);

    alert(
      "Não foi possível entrar no chat. Abra o console do navegador para verificar o erro."
    );
  }
}

socket.on("connect_error", (error) => {
  console.error("Erro na conexão Socket.IO:", error.message);

  alert(`Erro ao conectar ao chat: ${error.message}`);
});

/* ================= SALA ================= */

const params = new URLSearchParams(window.location.search);
let roomId = params.get("sala");

if (!roomId) {
  roomId = "geral";

  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set("sala", roomId);

  window.history.replaceState(
    {},
    "",
    `${currentUrl.pathname}${currentUrl.search}`
  );
}

socket.on("connect", () => {
  console.log("Socket conectado:", socket.id);

  socket.emit("join-room", roomId);
});

socket.on("disconnect", (reason) => {
  console.log("Socket desconectado:", reason);
});

/* ================= ELEMENTOS ================= */

const input = document.getElementById("chat-dig");
const btnEnviar = document.getElementById("enviar");
const messages = document.getElementById("messages");

const youtubeContainer = document.getElementById("youtube-container");
const closeYT = document.getElementById("close-yt");
const btnYoutube = document.getElementById("btn-youtube");

const btnPlay = document.getElementById("playVideo");
const btnPause = document.getElementById("pauseVideo");

/* ================= CHAT ================= */

btnEnviar.addEventListener("click", (event) => {
  event.preventDefault();
  sendMessage();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

function sendMessage() {
  const text = input.value.trim();

  if (!text || !socket.connected) {
    return;
  }

  socket.emit("chat-message", {
    roomId,
    message: text,
  });

  /*
    Apenas quem enviou verifica o link.

    Quando encontrar um vídeo, o evento open-video será enviado
    para toda a sala. Isso evita vários usuários disparando o
    mesmo evento ao receberem a mensagem.
  */
  checkYouTubeLink(text);

  input.value = "";
  input.focus();
}

function addMessage(messageData) {
  if (!messageData?.user || !messageData?.message) {
    return;
  }

  const isCurrentUser =
    currentUser && messageData.user.id === currentUser.id;

  const messageElement = document.createElement("div");

  messageElement.classList.add(
    "message",
    isCurrentUser ? "user" : "bot"
  );

  messageElement.dataset.messageId = messageData.id;

  const headerElement = document.createElement("div");
  headerElement.classList.add("message-header");

  const avatarElement = document.createElement("div");
  avatarElement.classList.add("message-avatar");

  if (messageData.user.avatar) {
    const avatarImage = document.createElement("img");

    avatarImage.src = messageData.user.avatar;
    avatarImage.alt = `Avatar de ${messageData.user.username}`;

    avatarElement.appendChild(avatarImage);
  } else {
    avatarElement.textContent = messageData.user.username
      .charAt(0)
      .toUpperCase();
  }

  const userInfoElement = document.createElement("div");
  userInfoElement.classList.add("message-user-info");

  const usernameElement = document.createElement("span");
  usernameElement.classList.add("message-username");
  usernameElement.textContent = messageData.user.username;

  const levelElement = document.createElement("span");
  levelElement.classList.add("message-level");
  levelElement.textContent = `LV ${messageData.user.level}`;

  userInfoElement.appendChild(usernameElement);
  userInfoElement.appendChild(levelElement);

  const textElement = document.createElement("div");
  textElement.classList.add("message-text");
  textElement.textContent = messageData.message;

  const timeElement = document.createElement("time");
  timeElement.classList.add("message-time");

  const createdAt = new Date(messageData.createdAt);

  timeElement.dateTime = messageData.createdAt;
  timeElement.textContent = Number.isNaN(createdAt.getTime())
    ? ""
    : createdAt.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });

  headerElement.appendChild(avatarElement);
  headerElement.appendChild(userInfoElement);
  headerElement.appendChild(timeElement);

  messageElement.appendChild(headerElement);
  messageElement.appendChild(textElement);

  messages.appendChild(messageElement);
  messages.scrollTop = messages.scrollHeight;
}

socket.on("chat-message", (messageData) => {
  addMessage(messageData);
});

/* ================= YOUTUBE ================= */

let player = null;
let playerReady = false;
let pendingVideoId = null;

function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }

    const oldCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof oldCallback === "function") {
        oldCallback();
      }

      resolve();
    };

    const existingScript = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (!existingScript) {
      const tag = document.createElement("script");

      tag.src = "https://www.youtube.com/iframe_api";

      document.head.appendChild(tag);
    }
  });
}

async function ensurePlayer() {
  if (player && playerReady) {
    return;
  }

  await loadYouTubeAPI();

  player = new YT.Player("youtube-frame", {
    width: "100%",
    height: "100%",

    playerVars: {
      autoplay: 1,
      controls: 1,
      mute: 1,
      playsinline: 1,
      origin: window.location.origin,
    },

    events: {
      onReady: () => {
        playerReady = true;

        if (pendingVideoId) {
          const videoId = pendingVideoId;

          pendingVideoId = null;

          loadVideo(videoId);
        }
      },

      onStateChange: onPlayerStateChange,

      onError: (event) => {
        console.log("Erro YouTube:", event.data);
      },
    },
  });
}

async function loadVideo(videoId) {
  youtubeContainer.classList.add("active");

  await ensurePlayer();

  if (!playerReady) {
    pendingVideoId = videoId;
    return;
  }

  isSyncing = true;

  player.loadVideoById(videoId);

  setTimeout(() => {
    try {
      player.playVideo();
    } catch (error) {
      console.error("Não foi possível iniciar o vídeo:", error);
    }

    isSyncing = false;
  }, 600);
}

function openYouTube(videoId) {
  socket.emit("open-video", {
    roomId,
    videoId,
  });
}

function extractYouTubeId(text) {
  const regex =
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/;

  const match = text.match(regex);

  return match ? match[1] : null;
}

function checkYouTubeLink(text) {
  const videoId = extractYouTubeId(text);

  if (videoId) {
    openYouTube(videoId);
  }
}

/* ================= EVENTOS DO PLAYER ================= */

function onPlayerStateChange(event) {
  if (!playerReady || !player || isSyncing) {
    return;
  }

  if (event.data === YT.PlayerState.PLAYING) {
    socket.emit("video-play", {
      roomId,
      currentTime: player.getCurrentTime(),
    });
  }

  if (event.data === YT.PlayerState.PAUSED) {
    socket.emit("video-pause", {
      roomId,
      currentTime: player.getCurrentTime(),
    });
  }
}

/* ================= SOCKET DO VÍDEO ================= */

socket.on("open-video", (videoId) => {
  loadVideo(videoId);
});

socket.on("video-play", (time) => {
  if (!playerReady || !player) {
    return;
  }

  isSyncing = true;

  try {
    const difference = Math.abs(
      player.getCurrentTime() - time
    );

    if (difference > 1) {
      player.seekTo(time, true);
    }

    player.playVideo();
  } catch (error) {
    console.error("Erro ao sincronizar reprodução:", error);
  }

  setTimeout(() => {
    isSyncing = false;
  }, 500);
});

socket.on("video-pause", (time) => {
  if (!playerReady || !player) {
    return;
  }

  isSyncing = true;

  try {
    player.seekTo(time, true);
    player.pauseVideo();
  } catch (error) {
    console.error("Erro ao sincronizar pausa:", error);
  }

  setTimeout(() => {
    isSyncing = false;
  }, 500);
});

socket.on("sync-state", (state) => {
  if (!state.videoId) {
    return;
  }

  loadVideo(state.videoId);

  const waitForPlayer = setInterval(() => {
    if (!playerReady || !player) {
      return;
    }

    clearInterval(waitForPlayer);

    isSyncing = true;

    try {
      player.seekTo(state.currentTime || 0, true);

      if (state.isPlaying) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } catch (error) {
      console.error("Erro ao aplicar estado do vídeo:", error);
    }

    setTimeout(() => {
      isSyncing = false;
    }, 700);
  }, 200);
});

/* ================= CONTROLES ================= */

btnPlay.addEventListener("click", () => {
  if (!playerReady || !player) {
    return;
  }

  player.unMute();
  player.playVideo();

  socket.emit("video-play", {
    roomId,
    currentTime: player.getCurrentTime(),
  });
});

btnPause.addEventListener("click", () => {
  if (!playerReady || !player) {
    return;
  }

  player.pauseVideo();

  socket.emit("video-pause", {
    roomId,
    currentTime: player.getCurrentTime(),
  });
});

closeYT.addEventListener("click", () => {
  youtubeContainer.classList.remove("active");

  if (playerReady && player) {
    player.stopVideo();
  }
});

btnYoutube.addEventListener("click", () => {
  youtubeContainer.classList.toggle("active");
});

/* ================= INICIALIZAÇÃO ================= */

loadAuthenticatedUser();