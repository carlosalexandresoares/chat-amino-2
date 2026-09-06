/*
  Salas públicas disponíveis.

  A chave é o ID usado no banco,
  na URL e no Socket.IO.
*/
export const publicRooms = {
  geral: {
    id: "geral",
    name: "Geral",
    icon: "🔥",
  },

  games: {
    id: "games",
    name: "Games",
    icon: "👾",
  },

  musica: {
    id: "musica",
    name: "Música",
    icon: "🎵",
  },

  filmes: {
    id: "filmes",
    name: "Filmes",
    icon: "🎬",
  },

  programacao: {
    id: "programacao",
    name: "Programação",
    icon: "💻",
  },

  anime: {
    id: "anime",
    name: "Anime",
    icon: "🎌",
  },
};

/**
 * Normaliza e valida o ID de uma sala pública.
 *
 * Retorna null quando a sala não existe.
 */
export function normalizePublicRoomId(
  roomId
) {
  if (typeof roomId !== "string") {
    return null;
  }

  const normalizedRoomId = roomId
    .trim()
    .toLowerCase();

  if (!publicRooms[normalizedRoomId]) {
    return null;
  }

  return normalizedRoomId;
}

/*
  Verifica se existe uma sala válida na URL.
*/
const params = new URLSearchParams(
  window.location.search
);

const requestedRoomId =
  params.get("sala");

let roomId =
  normalizePublicRoomId(
    requestedRoomId
  );

/*
  Caso alguém tente acessar uma sala
  pública inexistente pela URL, removemos
  o parâmetro e mostramos a tela de salas.
*/
if (requestedRoomId && !roomId) {
  const currentUrl = new URL(
    window.location.href
  );

  currentUrl.searchParams.delete(
    "sala"
  );

  window.history.replaceState(
    {},
    "",
    `${currentUrl.pathname}${currentUrl.search}`
  );
}

const token =
  localStorage.getItem("authToken");

const socket = io({
  autoConnect: false,

  auth: {
    token,
  },
});

const state = {
  token,

  /*
    Será null enquanto o usuário estiver
    na tela de seleção de salas.
  */
  roomId,

  socket,

  currentUser: null,

  roomRole: "MEMBER",
  canStartLive: false,

  liveActive: false,
  liveDetailsOpen: false,

  currentLiveId: null,
  currentLiveHost: null,
  currentPlaylist: [],

  isLiveHost: false,

  player: null,
  playerReady: false,
  pendingVideoState: null,

  isSyncing: false,
  timeUpdateInterval: null,
};

export default state;