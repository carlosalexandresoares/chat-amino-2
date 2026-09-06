import state from "./state.js";
import dom from "./dom.js";

function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (
      window.YT &&
      window.YT.Player
    ) {
      resolve();
      return;
    }

    const previousCallback =
      window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady =
      () => {
        if (
          typeof previousCallback ===
          "function"
        ) {
          previousCallback();
        }

        resolve();
      };

    const existingScript =
      document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]'
      );

    if (existingScript) {
      return;
    }

    const tag =
      document.createElement(
        "script"
      );

    tag.src =
      "https://www.youtube.com/iframe_api";

    document.head.appendChild(tag);
  });
}

async function ensurePlayer() {
  if (
    state.player &&
    state.playerReady
  ) {
    return;
  }

  await loadYouTubeAPI();

  state.player =
    new YT.Player(
      "youtube-frame",
      {
        width: "100%",
        height: "100%",

        playerVars: {
          autoplay: 1,
          controls: 1,
          mute: 1,
          playsinline: 1,
          origin:
            window.location.origin,
        },

        events: {
          onReady: () => {
            state.playerReady = true;

            if (
              state.pendingVideoState
            ) {
              const pending =
                state.pendingVideoState;

              state.pendingVideoState =
                null;

              applyVideoState(
                pending
              );
            }
          },

          onStateChange:
            handlePlayerStateChange,

          onError: (event) => {
            console.error(
              "Erro do YouTube:",
              event.data
            );
          },
        },
      }
    );
}

function handlePlayerStateChange(
  event
) {
  if (
    !state.playerReady ||
    !state.player ||
    state.isSyncing ||
    !state.isLiveHost
  ) {
    return;
  }

  if (
    event.data ===
    YT.PlayerState.PLAYING
  ) {
    state.socket.emit(
      "video-play",
      {
        roomId: state.roomId,
        currentTime:
          state.player.getCurrentTime(),
      }
    );

    startTimeUpdater();
  }

  if (
    event.data ===
    YT.PlayerState.PAUSED
  ) {
    state.socket.emit(
      "video-pause",
      {
        roomId: state.roomId,
        currentTime:
          state.player.getCurrentTime(),
      }
    );

    stopTimeUpdater();
  }

  if (
    event.data ===
    YT.PlayerState.ENDED
  ) {
    stopTimeUpdater();

    state.socket.emit(
      "video-ended",
      {
        roomId: state.roomId,
      }
    );
  }
}

export async function loadVideo(
  videoId,
  options = {}
) {
  if (!videoId) {
    return;
  }

  const currentTime =
    Number(
      options.currentTime
    ) || 0;

  const shouldPlay =
    options.isPlaying !== false;

  dom.youtubeContainer.classList.add(
    "active"
  );

  updatePlayerButton();

  await ensurePlayer();

  if (!state.playerReady) {
    state.pendingVideoState = {
      videoId,
      currentTime,
      isPlaying: shouldPlay,
    };

    return;
  }

  state.isSyncing = true;

  try {
    state.player.loadVideoById({
      videoId,
      startSeconds: currentTime,
    });

    window.setTimeout(() => {
      try {
        state.player.seekTo(
          currentTime,
          true
        );

        if (shouldPlay) {
          state.player.playVideo();
        } else {
          state.player.pauseVideo();
        }
      } catch (error) {
        console.error(
          "Erro ao carregar vídeo:",
          error
        );
      }

      window.setTimeout(() => {
        state.isSyncing = false;
      }, 500);
    }, 700);
  } catch (error) {
    state.isSyncing = false;

    console.error(
      "Não foi possível iniciar o vídeo:",
      error
    );
  }
}

export async function applyVideoState(
  videoState
) {
  if (!videoState?.videoId) {
    return;
  }

  await loadVideo(
    videoState.videoId,
    {
      currentTime:
        videoState.currentTime || 0,

      isPlaying:
        Boolean(
          videoState.isPlaying
        ),
    }
  );
}

export function startTimeUpdater() {
  stopTimeUpdater();

  if (!state.isLiveHost) {
    return;
  }

  state.timeUpdateInterval =
    window.setInterval(() => {
      if (
        !state.playerReady ||
        !state.player ||
        !state.liveActive
      ) {
        return;
      }

      state.socket.emit(
        "video-time-update",
        {
          roomId: state.roomId,
          currentTime:
            state.player.getCurrentTime(),
        }
      );
    }, 3000);
}

export function stopTimeUpdater() {
  if (!state.timeUpdateInterval) {
    return;
  }

  window.clearInterval(
    state.timeUpdateInterval
  );

  state.timeUpdateInterval = null;
}

export function setVideoControlAccess(
  allowed
) {
  dom.btnPlay.disabled = !allowed;
  dom.btnPause.disabled = !allowed;

  dom.btnPlay.title = allowed
    ? "Reproduzir vídeo"
    : "Somente o apresentador pode controlar";

  dom.btnPause.title = allowed
    ? "Pausar vídeo"
    : "Somente o apresentador pode controlar";

  dom.videoControls.classList.toggle(
    "locked",
    !allowed
  );
}

export function updatePlayerButton() {
  if (!state.liveActive) {
    dom.togglePlayerButton.classList.add(
      "hidden"
    );

    return;
  }

  dom.togglePlayerButton.classList.remove(
    "hidden"
  );

  const playerVisible =
    dom.youtubeContainer.classList.contains(
      "active"
    );

  dom.togglePlayerButton.textContent =
    playerVisible
      ? "Ocultar vídeo"
      : "Mostrar vídeo";
}

export function stopPlayer() {
  stopTimeUpdater();

  if (
    !state.playerReady ||
    !state.player
  ) {
    return;
  }

  state.isSyncing = true;

  try {
    state.player.stopVideo();
  } catch (error) {
    console.error(
      "Erro ao parar vídeo:",
      error
    );
  }

  window.setTimeout(() => {
    state.isSyncing = false;
  }, 300);
}

export function initializeYouTube() {
  dom.btnPlay.addEventListener(
    "click",
    () => {
      if (
        !state.isLiveHost ||
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      state.player.unMute();
      state.player.playVideo();
    }
  );

  dom.btnPause.addEventListener(
    "click",
    () => {
      if (
        !state.isLiveHost ||
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      state.player.pauseVideo();
    }
  );

  dom.closeYT.addEventListener(
    "click",
    () => {
      dom.youtubeContainer.classList.remove(
        "active"
      );

      updatePlayerButton();
    }
  );

  dom.btnYoutube.addEventListener(
    "click",
    () => {
      dom.youtubeContainer.classList.toggle(
        "active"
      );

      updatePlayerButton();
    }
  );

  dom.togglePlayerButton.addEventListener(
    "click",
    () => {
      dom.youtubeContainer.classList.toggle(
        "active"
      );

      updatePlayerButton();
    }
  );

  state.socket.on(
    "video-play",
    (time) => {
      if (
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      state.isSyncing = true;

      try {
        const normalizedTime =
          Number(time) || 0;

        const difference =
          Math.abs(
            state.player.getCurrentTime() -
              normalizedTime
          );

        if (difference > 1.5) {
          state.player.seekTo(
            normalizedTime,
            true
          );
        }

        state.player.playVideo();
      } catch (error) {
        console.error(
          "Erro ao sincronizar reprodução:",
          error
        );
      }

      window.setTimeout(() => {
        state.isSyncing = false;
      }, 500);
    }
  );

  state.socket.on(
    "video-pause",
    (time) => {
      if (
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      state.isSyncing = true;

      try {
        state.player.seekTo(
          Number(time) || 0,
          true
        );

        state.player.pauseVideo();
      } catch (error) {
        console.error(
          "Erro ao sincronizar pausa:",
          error
        );
      }

      window.setTimeout(() => {
        state.isSyncing = false;
      }, 500);
    }
  );
}