import state, {
  publicRooms,
  normalizePublicRoomId,
} from "./state.js";

import {
  loadAuthenticatedUser,
} from "./auth.js";

import {
  initializeChat,
} from "./chat.js";

import {
  initializeYouTube,
  stopTimeUpdater,
} from "./youtube.js";

import {
  initializeLive,
} from "./live.js";

/*
  Elementos da navegação entre
  a lista de salas e o chat.
*/
const roomsScreen =
  document.getElementById(
    "rooms-screen"
  );

const appScreen =
  document.getElementById(
    "app-screen"
  );

const currentRoomTitle =
  document.getElementById(
    "current-room-title"
  );

const leaveRoomButton =
  document.getElementById(
    "leave-room"
  );

const enterRoomButtons =
  document.querySelectorAll(
    ".enter-room-button"
  );

/**
 * Abre a tela de seleção de salas.
 */
function showRoomsScreen() {
  roomsScreen?.classList.remove(
    "hidden"
  );

  appScreen?.classList.add(
    "hidden"
  );

  document.title =
    "Salas públicas | Chat Amino 2";
}

/**
 * Abre a interface do chat.
 */
function showChatScreen(roomId) {
  const room =
    publicRooms[roomId];

  if (!room) {
    showRoomsScreen();
    return;
  }

  roomsScreen?.classList.add(
    "hidden"
  );

  appScreen?.classList.remove(
    "hidden"
  );

  if (currentRoomTitle) {
    currentRoomTitle.textContent =
      `${room.icon} ${room.name}`;
  }

  document.title =
    `${room.name} | Chat Amino 2`;
}

/**
 * Navega para uma sala pública.
 *
 * A URL ainda guarda internamente o ID,
 * mas o usuário escolhe pela interface.
 */
function enterRoom(roomId) {
  const validRoomId =
    normalizePublicRoomId(roomId);

  if (!validRoomId) {
    console.error(
      "Sala pública inválida:",
      roomId
    );

    return;
  }

  const currentUrl =
    new URL(
      window.location.href
    );

  currentUrl.searchParams.set(
    "sala",
    validRoomId
  );

  /*
    Recarregar a página é importante
    porque limpa corretamente:
    - sala anterior;
    - live anterior;
    - playlist anterior;
    - conexão anterior do Socket.IO.
  */
  window.location.href =
    `${currentUrl.pathname}${currentUrl.search}`;
}

/**
 * Volta à seleção de salas.
 */
function leaveCurrentRoom() {
  stopTimeUpdater();

  if (state.socket.connected) {
    state.socket.disconnect();
  }

  const currentUrl =
    new URL(
      window.location.href
    );

  currentUrl.searchParams.delete(
    "sala"
  );

  window.location.href =
    currentUrl.pathname;
}

/*
  Botões "Entrar".
*/
enterRoomButtons.forEach(
  (button) => {
    button.addEventListener(
      "click",
      () => {
        const roomId =
          button.dataset.roomId;

        enterRoom(roomId);
      }
    );
  }
);

/*
  Botão "Trocar de sala".
*/
leaveRoomButton?.addEventListener(
  "click",
  leaveCurrentRoom
);

/*
  Inicializa os módulos que controlam
  os elementos da aplicação.
*/
initializeChat();
initializeYouTube();
initializeLive();

/*
  Quando o Socket.IO conectar, entra
  somente na sala pública selecionada.
*/
state.socket.on(
  "connect",
  () => {
    console.log(
      "Socket conectado:",
      state.socket.id
    );

    if (!state.roomId) {
      console.warn(
        "Conexão sem sala selecionada."
      );

      state.socket.disconnect();
      return;
    }

    state.socket.emit(
      "join-room",
      state.roomId
    );
  }
);

state.socket.on(
  "disconnect",
  (reason) => {
    console.log(
      "Socket desconectado:",
      reason
    );

    stopTimeUpdater();
  }
);

state.socket.on(
  "connect_error",
  (error) => {
    console.error(
      "Erro no Socket.IO:",
      error.message
    );

    /*
      Só mostra erro quando o usuário
      realmente está dentro de uma sala.
    */
    if (state.roomId) {
      alert(
        `Erro ao conectar ao chat: ${error.message}`
      );
    }
  }
);

/*
  Decide qual tela será mostrada.
*/
if (state.roomId) {
  showChatScreen(
    state.roomId
  );
} else {
  showRoomsScreen();
}

/*
  Mantém a autenticação existente.

  O auth.js continuará responsável por
  carregar o usuário e iniciar o socket,
  como já acontecia anteriormente.
*/
loadAuthenticatedUser();