import state from "./state.js";
import dom from "./dom.js";
import { syncMiniPlayer, hideMiniPlayer, setPipResyncHandler, handleExternalPipError } from './mini-player.js?v=7';

let apiPromise;
let playerPromise;
let playerHostMode = null;
let loadedVideoId = null;
let syncReleaseTimer;
let latestSnapshot = null;
const floatingGuest = window !== window.top && new URLSearchParams(window.location.search).has('floatingGuest');

function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.append(script);
    }
  });
  return apiPromise;
}

function holdSync() {
  state.isSyncing = true;
  window.clearTimeout(syncReleaseTimer);
  syncReleaseTimer = window.setTimeout(() => { state.isSyncing = false; }, 900);
}

function playerVisible() {
  return dom.youtubeContainer.classList.contains("active");
}

async function ensurePlayer() {
  await loadYouTubeAPI();
  const hostMode = Boolean(state.isLiveHost);
  if (state.player && playerHostMode !== hostMode) {
    stopTimeUpdater();
    state.player.destroy();
    state.player = null;
    state.playerReady = false;
    loadedVideoId = null;
    playerPromise = null;
    const frame = document.createElement("div");
    frame.id = "youtube-frame";
    dom.youtubeStage.prepend(frame);
  }
  if (state.playerReady && state.player) return;
  if (playerPromise) return playerPromise;
  playerHostMode = hostMode;
  playerPromise = new Promise((resolve) => {
    state.player = new YT.Player("youtube-frame", {
      width: "100%", height: "100%",
      playerVars: {
        autoplay: 0, controls: hostMode ? 1 : 0,
        disablekb: hostMode ? 0 : 1, fs: 1,
        mute: 1, playsinline: 1, origin: window.location.origin,
      },
      events: {
        onReady: () => {
          const iframe = state.player.getIframe();
          const permissions = new Set((iframe.getAttribute('allow') || '').split(';').map(value => value.trim()).filter(Boolean));
          permissions.add('picture-in-picture');
          permissions.add('fullscreen');
          iframe.setAttribute('allow', [...permissions].join('; '));
          iframe.allowFullscreen = true;
          state.playerReady = true;
          resolve();
        },
        onStateChange: handlePlayerStateChange,
        onError: (event) => {
          if (!handleExternalPipError(event.data)) console.error("Erro do YouTube:", event.data);
        },
      },
    });
  });
  return playerPromise;
}

function handlePlayerStateChange(event) {
  if (!state.playerReady || !state.player || !state.isLiveHost ||
      !state.liveActive || !state.socket.connected || !playerVisible() || state.isSyncing) return;
  if (event.data === YT.PlayerState.PLAYING) {
    state.socket.emit("video-play", { roomId: state.roomId, currentTime: state.player.getCurrentTime() });
    startTimeUpdater();
  } else if (event.data === YT.PlayerState.PAUSED) {
    stopTimeUpdater();
    state.socket.emit("video-pause", { roomId: state.roomId, currentTime: state.player.getCurrentTime() });
  } else if (event.data === YT.PlayerState.ENDED) {
    stopTimeUpdater();
    state.socket.emit("video-ended", { roomId: state.roomId });
  }
}

export async function loadVideo(videoId, options = {}) {
  if (floatingGuest || !videoId || !state.liveActive) return;
  const currentTime = Math.max(0, Number(options.currentTime) || 0);
  const isPlaying = options.isPlaying !== false;
  state.pendingVideoState = { videoId, currentTime, isPlaying };
  latestSnapshot = state.pendingVideoState;
  dom.youtubeContainer.classList.add("active");
  updatePlayerButton();
  syncMiniPlayer();
  await ensurePlayer();
  if (!state.liveActive || !state.playerReady) return;
  const pending = state.pendingVideoState;
  if (!pending) return;
  state.pendingVideoState = null;
  holdSync();
  try {
    loadedVideoId = pending.videoId;
    if (pending.isPlaying) {
      state.player.loadVideoById({ videoId: pending.videoId, startSeconds: pending.currentTime });
      if (state.isLiveHost) startTimeUpdater();
    } else {
      stopTimeUpdater();
      state.player.cueVideoById({ videoId: pending.videoId, startSeconds: pending.currentTime });
    }
  } catch (error) { console.error("Não foi possível iniciar o vídeo:", error); }
}

export function applyVideoState(videoState) {
  if (floatingGuest || !videoState?.videoId || !state.liveActive) return;
  latestSnapshot = videoState;
  if (!state.playerReady || loadedVideoId !== videoState.videoId || playerHostMode !== Boolean(state.isLiveHost)) {
    return loadVideo(videoState.videoId, videoState);
  }
  if (!playerVisible()) return;
  if (state.isLiveHost && !videoState.force) return;
  try {
    const target = Math.max(0, Number(videoState.currentTime) || 0);
    const difference = Math.abs(state.player.getCurrentTime() - target);
    const playing = state.player.getPlayerState() === YT.PlayerState.PLAYING;
    if (difference > 1.5 || playing !== Boolean(videoState.isPlaying)) holdSync();
    if (difference > 1.5) state.player.seekTo(target, true);
    if (videoState.isPlaying && !playing) state.player.playVideo();
    if (!videoState.isPlaying && playing) state.player.pauseVideo();
    if (state.isLiveHost && videoState.force && videoState.isPlaying) startTimeUpdater();
  } catch (error) { console.error("Erro ao sincronizar vídeo:", error); }
}

export function startTimeUpdater() {
  stopTimeUpdater();
  if (!state.isLiveHost) return;
  state.timeUpdateInterval = window.setInterval(() => {
    if (!state.playerReady || !state.player || !state.liveActive ||
        !state.socket.connected || !playerVisible() || state.isSyncing ||
        state.player.getPlayerState() !== YT.PlayerState.PLAYING) return;
    state.socket.emit("video-time-update", {
      roomId: state.roomId, currentTime: state.player.getCurrentTime(),
    });
  }, 1500);
}

export function stopTimeUpdater() {
  if (state.timeUpdateInterval) window.clearInterval(state.timeUpdateInterval);
  state.timeUpdateInterval = null;
}

export function setVideoControlAccess(allowed) {
  dom.viewerOverlay.classList.toggle("hidden", allowed);
  if (!allowed) dom.viewerSound.textContent = state.playerReady && !state.player?.isMuted() ? "Silenciar" : "Ativar som";
}

export function updatePlayerButton() {
  if (floatingGuest) { dom.togglePlayerButton.classList.add('hidden'); return; }
  dom.togglePlayerButton.classList.toggle("hidden", !state.liveActive);
  if (state.liveActive) dom.togglePlayerButton.textContent = playerVisible() ? "Ocultar vídeo" : "Mostrar vídeo";
}

export function stopPlayer() {
  stopTimeUpdater();
  state.pendingVideoState = null;
  loadedVideoId = null;
  latestSnapshot = null;
  if (!state.playerReady || !state.player) return;
  holdSync();
  try { state.player.stopVideo(); } catch (error) { console.error("Erro ao parar vídeo:", error); }
}

function requestCurrentVideo(forceReload = false) {
  if (!state.liveActive || !state.socket.connected) return;
  state.socket.emit("video-sync-request", { roomId: state.roomId }, (response) => {
    if (response?.success && response.videoId) {
      if (forceReload) loadVideo(response.videoId, response);
      else applyVideoState({ ...response, force: true });
    }
  });
}

function togglePlayer(visible) {
  if (floatingGuest || !state.liveActive) return;
  if (!visible) hideMiniPlayer();
  dom.youtubeContainer.classList.toggle("active", visible);
  updatePlayerButton();
  syncMiniPlayer();
  if (visible) requestCurrentVideo();
  else stopTimeUpdater();
}

export function initializeYouTube() {
  setPipResyncHandler(() => requestCurrentVideo(true));
  dom.closeYT.addEventListener("click", () => togglePlayer(false));
  dom.btnYoutube?.addEventListener("click", () => togglePlayer(!playerVisible()));
  dom.togglePlayerButton.addEventListener("click", () => togglePlayer(!playerVisible()));
  dom.viewerSound.addEventListener("click", () => {
    if (!state.playerReady || !state.player || state.isLiveHost) return;
    if (state.player.isMuted()) state.player.unMute();
    else state.player.mute();
    if (latestSnapshot?.isPlaying && state.player.getPlayerState() !== YT.PlayerState.PLAYING) state.player.playVideo();
    dom.viewerSound.textContent = state.player.isMuted() ? "Ativar som" : "Silenciar";
  });
  window.addEventListener("pagehide", () => { state.liveActive = false; stopTimeUpdater(); });
  state.socket.on("video-sync", (snapshot) => {
    if (!state.liveActive || !snapshot?.videoId || !playerVisible()) return;
    if (!state.isLiveHost) applyVideoState(snapshot);
  });
}
