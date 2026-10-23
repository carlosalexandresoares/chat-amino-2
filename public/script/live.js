import state from "./state.js";
import dom from "./dom.js";
import { initializeProjectionUi, syncProjectionUi, onProjectionEnded } from './projection-ui.js';
import { syncMiniPlayer, projectionFinished } from './mini-player.js?v=8';

import {
  showElement,
  hideElement,
  setButtonLoading,
  extractYouTubeId,
} from "./utils.js";

import {
  applyVideoState,
  loadVideo,
  setVideoControlAccess,
  stopPlayer,
  stopTimeUpdater,
  updatePlayerButton,
} from "./youtube.js?v=10";

function setLiveFormMessage(
  message,
  type = ""
) {
  dom.liveFormMessage.textContent =
    message;

  dom.liveFormMessage.classList.remove(
    "success",
    "error"
  );

  if (type) {
    dom.liveFormMessage.classList.add(
      type
    );
  }
}

function updateHostDisplay() {
  const host =
    state.currentLiveHost;

  dom.liveHostAvatar.innerHTML = "";

  if (!host) {
    dom.liveHostName.textContent =
      "Desconhecido";

    dom.liveHostAvatar.textContent =
      "?";

    return;
  }

  dom.liveHostName.textContent =
    host.username || "Usuário";

  if (host.avatar) {
    const image =
      document.createElement("img");

    image.src = host.avatar;
    image.alt =
      `Avatar de ${host.username}`;

    dom.liveHostAvatar.appendChild(
      image
    );

    return;
  }

  dom.liveHostAvatar.textContent =
    (host.username || "?")
      .charAt(0)
      .toUpperCase();
}

function renderPlaylist(playlist) {
  state.currentPlaylist =
    Array.isArray(playlist)
      ? playlist
      : [];
  syncMiniPlayer();

  dom.playlistElement.innerHTML = "";

  const total =
    state.currentPlaylist.length;

  dom.playlistCount.textContent =
    total === 1
      ? "1 vídeo"
      : `${total} vídeos`;

  if (total === 0) {
    showElement(
      dom.playlistEmpty
    );

    return;
  }

  hideElement(
    dom.playlistEmpty
  );

  state.currentPlaylist.forEach(
    (item) => {
      const listItem =
        document.createElement("li");

      listItem.classList.add(
        "playlist-item"
      );

      if (
        item.status === "PLAYING"
      ) {
        listItem.classList.add(
          "playing"
        );
      }

      const statusElement =
        document.createElement("span");

      statusElement.classList.add(
        "playlist-item-status"
      );

      statusElement.textContent =
        item.status === "PLAYING"
          ? "▶"
          : item.position;

      const informationElement =
        document.createElement("div");

      informationElement.classList.add(
        "playlist-item-info"
      );

      const titleElement =
        document.createElement("strong");

      titleElement.textContent =
        item.title ||
        `Vídeo ${item.position}`;

      const statusText =
        document.createElement("span");

      statusText.textContent =
        item.status === "PLAYING"
          ? "Reproduzindo agora"
          : "Aguardando";

      informationElement.append(
        titleElement,
        statusText
      );

      listItem.append(
        statusElement,
        informationElement
      );

      dom.playlistElement.appendChild(
        listItem
      );
    }
  );
}

function updateLiveDetails() {
  if (!state.liveActive) {
    hideElement(
      dom.toggleLiveDetailsButton
    );

    dom.liveContent.classList.remove(
      "details-open"
    );

    return;
  }

  showElement(
    dom.toggleLiveDetailsButton
  );

  dom.liveContent.classList.toggle(
    "details-open",
    state.liveDetailsOpen
  );

  dom.toggleLiveDetailsButton.textContent =
    state.liveDetailsOpen
      ? "Recolher"
      : state.isLiveHost
        ? "Gerenciar"
        : "Ver playlist";

  dom.toggleLiveDetailsButton.setAttribute(
    "aria-expanded",
    String(
      state.liveDetailsOpen
    )
  );
}

export function updateLiveInterface() {
  const hostIsCurrentUser =
    Boolean(
      state.currentUser &&
      state.currentLiveHost &&
      state.currentUser.id ===
        state.currentLiveHost.id
    );

  state.isLiveHost =
    state.liveActive &&
    hostIsCurrentUser;

  dom.livePanel.classList.toggle(
    "active",
    state.liveActive
  );

  dom.liveIndicator.classList.toggle(
    "active",
    state.liveActive
  );

  if (!state.liveActive) {
    dom.liveTitle.textContent =
      "Nenhuma live ativa";

    dom.liveDescription.textContent =
      "Um administrador pode iniciar uma sessão para todos assistirem juntos.";

    hideElement(dom.liveContent);
    hideElement(dom.hostControls);
    hideElement(dom.liveActions);
    hideElement(
      dom.toggleLiveDetailsButton
    );
    hideElement(
      dom.togglePlayerButton
    );

    if (state.canStartLive) {
      showElement(
        dom.startLiveButton
      );
    } else {
      hideElement(
        dom.startLiveButton
      );
    }

    setVideoControlAccess(false);
    stopTimeUpdater();
    syncProjectionUi();
    syncMiniPlayer();

    return;
  }

  hideElement(
    dom.startLiveButton
  );

  showElement(
    dom.liveContent
  );

  dom.liveTitle.textContent =
    "Live em andamento";

  dom.liveDescription.textContent =
    state.isLiveHost
      ? "Você está controlando esta live."
      : "Os controles pertencem ao apresentador.";

  updateHostDisplay();

  if (state.isLiveHost) {
    showElement(dom.hostControls);
    showElement(dom.liveActions);
    setVideoControlAccess(true);
  } else {
    hideElement(dom.hostControls);
    hideElement(dom.liveActions);
    setVideoControlAccess(false);
  }

  updateLiveDetails();
  updatePlayerButton();
  syncProjectionUi();
  syncMiniPlayer();
}

function resetLiveState() {
  projectionFinished();
  state.liveActive = false;
  state.liveDetailsOpen = false;

  state.currentLiveId = null;
  state.currentLiveHost = null;
  state.currentPlaylist = [];

  state.isLiveHost = false;

  renderPlaylist([]);
  setLiveFormMessage("");

  dom.youtubeContainer.classList.remove(
    "active"
  );

  updateLiveInterface();
}

function addVideoToPlaylist() {
  if (!state.isLiveHost) {
    setLiveFormMessage(
      "Você não controla esta live.",
      "error"
    );

    return;
  }

  const videoId =
    extractYouTubeId(
      dom.liveVideoLink.value
    );

  if (!videoId) {
    setLiveFormMessage(
      "Cole um link válido do YouTube.",
      "error"
    );

    return;
  }

  setButtonLoading(
    dom.addToPlaylistButton,
    true,
    "Adicionando..."
  );

  state.socket.emit(
    "playlist-add",
    {
      roomId: state.roomId,
      videoId,
      title:
        `Vídeo ${state.currentPlaylist.length + 1}`,
    },
    (response) => {
      setButtonLoading(
        dom.addToPlaylistButton,
        false
      );

      if (!response?.success) {
        setLiveFormMessage(
          response?.message ||
            "Não foi possível adicionar o vídeo.",
          "error"
        );

        return;
      }

      dom.liveVideoLink.value = "";

      setLiveFormMessage(
        "Vídeo adicionado à playlist.",
        "success"
      );

      dom.liveVideoLink.focus();
    }
  );
}

export function initializeLive() {
  initializeProjectionUi();
  dom.toggleLiveDetailsButton.addEventListener(
    "click",
    () => {
      if (!state.liveActive) {
        return;
      }

      state.liveDetailsOpen =
        !state.liveDetailsOpen;

      updateLiveDetails();
    }
  );

  dom.startLiveButton.addEventListener(
    "click",
    () => {
      if (
        !state.canStartLive ||
        state.liveActive
      ) {
        return;
      }

      setButtonLoading(
        dom.startLiveButton,
        true,
        "Iniciando..."
      );

      state.socket.emit(
        "live-start",
        {
          roomId: state.roomId,
        },
        (response) => {
          setButtonLoading(
            dom.startLiveButton,
            false
          );

          if (!response?.success) {
            alert(
              response?.message ||
                "Não foi possível iniciar a live."
            );
          }
        }
      );
    }
  );

  dom.addToPlaylistButton.addEventListener(
    "click",
    addVideoToPlaylist
  );

  dom.liveVideoLink.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      addVideoToPlaylist();
    }
  );

  dom.nextVideoButton.addEventListener(
    "click",
    () => {
      if (!state.isLiveHost) {
        return;
      }

      setButtonLoading(
        dom.nextVideoButton,
        true,
        "Avançando..."
      );

      state.socket.emit(
        "playlist-next",
        {
          roomId: state.roomId,
        },
        (response) => {
          setButtonLoading(
            dom.nextVideoButton,
            false
          );

          if (!response?.success) {
            alert(
              response?.message ||
                "Não foi possível avançar."
            );
          }
        }
      );
    }
  );

  dom.endLiveButton.addEventListener(
    "click",
    () => {
      if (!state.isLiveHost) {
        return;
      }

      const confirmed =
        window.confirm(
          "Deseja realmente encerrar a live?"
        );

      if (!confirmed) {
        return;
      }

      state.socket.emit(
        "live-end",
        {
          roomId: state.roomId,
        }
      );
    }
  );

  state.socket.on(
    "room-permissions",
    (permissions) => {
      state.roomRole =
        permissions?.role ||
        "MEMBER";

      state.canStartLive =
        Boolean(
          permissions?.canStartLive
        );

      updateLiveInterface();
    }
  );

  state.socket.on(
    "live-state",
    async (liveState) => {
      if (!liveState?.active) {
        stopPlayer();
        resetLiveState();
        return;
      }

      state.liveActive = true;
      state.liveDetailsOpen = false;

      state.currentLiveId =
        liveState.id;

      state.currentLiveHost =
        liveState.host || null;

      renderPlaylist(
        liveState.playlist
      );

      updateLiveInterface();

      if (
        liveState.currentVideoId
      ) {
        await applyVideoState({
          videoId:
            liveState.currentVideoId,

          currentTime:
            liveState.currentTime || 0,

          isPlaying:
            liveState.isPlaying,
        });
      }
    }
  );

  state.socket.on(
    "live-started",
    (liveData) => {
      state.liveActive = true;
      state.liveDetailsOpen = false;

      state.currentLiveId =
        liveData.id;

      state.currentLiveHost =
        liveData.host || null;

      renderPlaylist(
        liveData.playlist || []
      );

      updateLiveInterface();
    }
  );

  state.socket.on(
    "playlist-updated",
    renderPlaylist
  );

  state.socket.on(
    "live-video-changed",
    async (videoData) => {
      if (!videoData?.videoId) {
        return;
      }

      await loadVideo(
        videoData.videoId,
        {
          currentTime:
            videoData.currentTime || 0,

          isPlaying:
            videoData.isPlaying !== false,
        }
      );
    }
  );

  state.socket.on(
    "playlist-finished",
    () => {
      stopTimeUpdater();

      setLiveFormMessage(
        state.isLiveHost
          ? "A playlist terminou. Adicione outro vídeo."
          : "A playlist terminou."
      );
    }
  );

  state.socket.on(
    "live-ended",
    (payload) => {
      const reportId = payload?.id || state.currentLiveId;
      const wasHost = state.isLiveHost;
      stopPlayer();
      resetLiveState();
      onProjectionEnded(reportId, wasHost);
    }
  );

  renderPlaylist([]);
  updateLiveInterface();
}
