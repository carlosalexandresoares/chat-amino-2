/**
 * Valida o formato do ID de sala recebido pela URL.
 * A existência é confirmada pela API de salas.
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

  if (!/^[a-z0-9_-]{1,50}$/.test(normalizedRoomId)) {
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
