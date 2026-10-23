import state from './state.js';
import dom from './dom.js';

const $ = id => document.getElementById(id);
const preferenceKey = 'floatingVideoEnabled';
const allowedPages = new Set(['/index.html', '/', '/perfil.html', '/editar-perfil.html', '/communities.html', '/room.html', '/admin.html', '/direct.html']);
let initialized = false;
let noticeTimer;
let pipWindow = null;
let pipOpening = false;
let pipIframe = null;
let pipFrameLoadHandler = null;
let pipMessageHandler = null;
let pipHostWindow = null;
let pipResyncHandler = () => {};

export function setPipResyncHandler(handler) { pipResyncHandler = handler; }

function externalPipAvailable() {
  return window === window.top && window.isSecureContext && 'documentPictureInPicture' in window;
}

function isAndroidBrowser() {
  return /Android/i.test(navigator.userAgent);
}

function restoreExternalPip(closeWindow = false, resync = true) {
  const previousWindow = pipWindow;
  if (!previousWindow) return;
  pipWindow = null;
  const frame = pipIframe;
  if (pipIframe && pipFrameLoadHandler) pipIframe.removeEventListener('load', pipFrameLoadHandler);
  if (pipMessageHandler && pipHostWindow) pipHostWindow.removeEventListener('message', pipMessageHandler);
  pipIframe = null;
  pipFrameLoadHandler = null;
  pipMessageHandler = null;
  pipHostWindow = null;
  dom.youtubeContainer.append(dom.youtubeStage);
  $('pip-placeholder').classList.add('hidden');
  if (closeWindow && !previousWindow.closed) previousWindow.close();
  if (resync && state.liveActive && state.playerReady) {
    let requested = false;
    const resyncOnce = () => {
      if (requested || !state.liveActive) return;
      requested = true;
      pipResyncHandler();
    };
    frame?.addEventListener('load', resyncOnce, { once: true });
    setTimeout(resyncOnce, 1000);
  }
  syncMiniPlayer();
}

function showPipHelp(message = '') {
  const iframe = state.player?.getIframe?.();
  $('pip-fullscreen').disabled = !iframe || (!iframe.requestFullscreen && !iframe.webkitRequestFullscreen);
  $('pip-help-status').textContent = message || ($('pip-fullscreen').disabled
    ? 'Este navegador não permite abrir o player em tela cheia por este botão.' : '');
  if (!$('pip-help-dialog').open) $('pip-help-dialog').showModal();
}

export function handleExternalPipError(code) {
  if (!pipWindow || code !== 153) return false;
  restoreExternalPip(true);
  showPipHelp('O YouTube recusou a reprodução na janela externa (erro 153). O player voltou ao chat.');
  return true;
}

async function openExternalPip() {
  if (!state.liveActive || !state.playerReady || !dom.youtubeContainer.classList.contains('active')) {
    notify('Abra um vídeo da projeção para tentar o PiP.');
    return;
  }
  if (pipWindow) { restoreExternalPip(true); return; }
  if (pipOpening) return;
  if (!externalPipAvailable()) {
    // Android Chrome cannot open Document PiP here. Fullscreen is a
    // best-effort route to the browser's own video PiP when it is permitted.
    if (isAndroidBrowser()) {
      await tryFullscreenForPip();
      return;
    }
    showPipHelp('Este navegador não oferece PiP externo para o player incorporado do YouTube.');
    return;
  }
  pipOpening = true;
  let opened;
  try {
    const wasPlaying = state.player?.getPlayerState?.() === 1;
    let iframeReloaded = false;
    let receivedYouTubeMessage = false;
    // requestWindow must run directly in this user click; awaiting first loses activation.
    opened = await window.documentPictureInPicture.requestWindow({ width: 420, height: 320 });
    if (!state.liveActive || !dom.youtubeContainer.classList.contains('active')) {
      opened.close();
      return;
    }
    pipWindow = opened;
    opened.addEventListener('pagehide', () => {
      if (pipWindow === opened) restoreExternalPip();
    }, { once: true });
    opened.document.title = 'Projeção · Purp';
    const style = opened.document.createElement('style');
    style.textContent = `*{box-sizing:border-box}body{margin:0;background:#14182a;color:#fff;font:13px system-ui,sans-serif}
      header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:42px;padding:6px 10px;background:#23233b}
      header span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button{border:1px solid #b9a5d4;border-radius:7px;padding:5px 8px;background:#6749a3;color:#fff;cursor:pointer}
      #pip-host-frame{display:block;width:100%;aspect-ratio:16/9;border:0;background:#000}`;
    opened.document.head.append(style);
    const header = opened.document.createElement('header');
    const label = opened.document.createElement('span');
    label.id = 'pip-title';
    label.textContent = `${$('mini-room-name').textContent || 'Projeção'} · ${$('mini-video-name').textContent}`;
    const back = opened.document.createElement('button');
    back.type = 'button'; back.textContent = 'Voltar';
    back.addEventListener('click', () => returnToProjection());
    header.append(label, back);
    opened.document.body.append(header);
    const hostFrame = opened.document.createElement('iframe');
    hostFrame.id = 'pip-host-frame';
    hostFrame.allow = 'autoplay; picture-in-picture';
    hostFrame.src = new URL('/pip-host.html', location.origin).href;
    const hostLoaded = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('A página do player não carregou.')), 10000);
      hostFrame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      hostFrame.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('A página do player não carregou.')); }, { once: true });
    });
    opened.document.body.append(hostFrame);
    await hostLoaded;
    if (pipWindow !== opened || opened.closed || !state.liveActive) return;
    if (hostFrame.contentWindow.location.origin !== location.origin) throw new Error('Origem do player inválida.');
    pipHostWindow = hostFrame.contentWindow;
    pipIframe = state.player.getIframe();
    pipIframe.referrerPolicy = 'strict-origin-when-cross-origin';
    pipFrameLoadHandler = () => {
      // Some browsers reload an iframe when it moves between documents.
      // Reapply the authoritative Socket.IO snapshot if that happens.
      iframeReloaded = true;
      if (pipWindow === opened && state.liveActive) setTimeout(pipResyncHandler, 300);
    };
    pipIframe.addEventListener('load', pipFrameLoadHandler);
    pipMessageHandler = event => {
      if (event.source !== pipIframe?.contentWindow ||
          !/^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com$/.test(event.origin)) return;
      receivedYouTubeMessage = true;
      // The YouTube iframe posts to its current parent. Keep the existing
      // YT.Player API listener in the opener receiving those state updates.
      window.dispatchEvent(new MessageEvent('message', { data: event.data, origin: event.origin, source: event.source }));
    };
    pipHostWindow.addEventListener('message', pipMessageHandler);
    hostFrame.contentDocument.body.append(dom.youtubeStage);
    $('pip-placeholder').classList.remove('hidden');
    notify('Janela flutuante aberta. O PiP automático depende do navegador e das permissões.');
    setTimeout(() => {
      if (pipWindow !== opened || !state.liveActive || !wasPlaying) return;
      let stillPlaying = false;
      try { stillPlaying = state.player?.getPlayerState?.() === 1; } catch { /* Player unavailable after moving. */ }
      if (iframeReloaded && !receivedYouTubeMessage && !stillPlaying) {
        restoreExternalPip(true);
        showPipHelp('O YouTube interrompeu o vídeo ao mover o iframe. O player voltou ao chat; tente o PiP do próprio YouTube, se disponível.');
      }
    }, 8000);
  } catch (error) {
    if (pipWindow === opened) restoreExternalPip(true);
    else if (opened && !opened.closed) opened.close();
    showPipHelp(`Não foi possível abrir o PiP externo (${error?.name || 'bloqueado'}).`);
  } finally { pipOpening = false; }
}

export function floatingEnabled() {
  return localStorage.getItem(preferenceKey) !== 'false';
}

function notify(message) {
  const notice = $('mini-player-notice');
  notice.textContent = message;
  notice.classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.add('hidden'), 6000);
}

function resetPosition() {
  const player = dom.youtubeContainer;
  player.style.left = '';
  player.style.top = '';
  player.style.right = '';
  player.style.bottom = '';
}

export function syncMiniPlayer() {
  const player = dom.youtubeContainer;
  if (!state.liveActive) {
    restoreExternalPip(true, false);
    player.classList.remove('mini-mode', 'mini-minimized');
    resetPosition();
    $('mini-open').classList.add('hidden');
    return;
  }
  $('mini-open').classList.toggle('hidden', !player.classList.contains('active'));
  $('mini-room-name').textContent = $('current-room-title').textContent.trim();
  $('mini-host-name').textContent = `Host: ${state.currentLiveHost?.username || 'Desconhecido'}`;
  const playing = state.currentPlaylist.find(item => item.status === 'PLAYING');
  $('mini-video-name').textContent = playing?.title || 'Vídeo da projeção';
  if (pipWindow && !pipWindow.closed) {
    const title = pipWindow.document.getElementById('pip-title');
    if (title) title.textContent = `${$('mini-room-name').textContent} · ${$('mini-video-name').textContent}`;
  }
  $('mini-minimize').textContent = player.classList.contains('mini-minimized') ? 'Mostrar vídeo' : 'Minimizar';
}

export function showMiniPlayer() {
  if (!state.liveActive || !dom.youtubeContainer.classList.contains('active')) return;
  dom.youtubeContainer.classList.add('mini-mode');
  dom.youtubeContainer.classList.remove('mini-minimized');
  syncMiniPlayer();
}

export function hideMiniPlayer() {
  restoreExternalPip(true);
  dom.youtubeContainer.classList.remove('mini-mode', 'mini-minimized');
  resetPosition();
  syncMiniPlayer();
}

export function returnToProjection() {
  restoreExternalPip(true);
  const view = $('site-view');
  view.classList.add('hidden');
  $('site-frame').removeAttribute('src');
  hideMiniPlayer();
}

export function openSitePage(address) {
  if (!state.liveActive || !floatingEnabled() || !dom.youtubeContainer.classList.contains('active')) return false;
  const url = new URL(address, location.href);
  if (url.origin !== location.origin || !allowedPages.has(url.pathname)) return false;
  if ((url.pathname === '/' || url.pathname === '/index.html') && url.searchParams.get('sala') === state.roomId) {
    returnToProjection();
    return true;
  }
  if ((url.pathname === '/' || url.pathname === '/index.html') && url.searchParams.has('sala')) url.searchParams.set('floatingGuest', '1');
  showMiniPlayer();
  $('site-view').classList.remove('hidden');
  $('site-frame').src = url.pathname + url.search + url.hash;
  return true;
}

export function projectionFinished() {
  const wasFloating = dom.youtubeContainer.classList.contains('mini-mode') || Boolean(pipWindow);
  restoreExternalPip(true, false);
  if (!$('site-view').classList.contains('hidden')) returnToProjection();
  else hideMiniPlayer();
  if (wasFloating) notify('A projeção foi encerrada pelo host.');
}

async function tryFullscreenForPip() {
  const iframe = state.player?.getIframe?.();
  if (!iframe || !state.liveActive) return;
  try {
    dom.youtubeContainer.classList.remove('mini-minimized');
    syncMiniPlayer();
    const request = iframe.requestFullscreen || iframe.webkitRequestFullscreen;
    if (!request) throw new Error('unsupported');
    // Keep the call in the same click so the browser still has user activation.
    await request.call(iframe);
    if ($('pip-help-dialog').open) $('pip-help-dialog').close();
  } catch {
    showPipHelp('O navegador bloqueou a tela cheia deste vídeo. Se o player mostrar seu próprio botão de tela cheia ou PiP, tente por ele.');
  }
}

function bindDrag() {
  const handle = $('mini-player-header');
  let drag = null;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = dom.youtubeContainer.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    try { handle.setPointerCapture(event.pointerId); } catch { /* O gesto ainda pode ser acompanhado dentro do cabeçalho. */ }
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const width = dom.youtubeContainer.offsetWidth;
    const height = dom.youtubeContainer.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - width - 8, drag.left + event.clientX - drag.x));
    const top = Math.max(8, Math.min(innerHeight - height - 8, drag.top + event.clientY - drag.y));
    dom.youtubeContainer.style.left = `${left}px`;
    dom.youtubeContainer.style.top = `${top}px`;
    dom.youtubeContainer.style.right = 'auto';
    dom.youtubeContainer.style.bottom = 'auto';
  });
  const finish = event => { if (drag?.id === event.pointerId) drag = null; };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  window.addEventListener('resize', () => {
    if (dom.youtubeContainer.classList.contains('mini-mode')) resetPosition();
  });
}

export function initializeMiniPlayer() {
  if (initialized) return;
  initialized = true;
  $('floating-video-preference').checked = floatingEnabled();
  $('floating-video-preference').addEventListener('change', event => {
    localStorage.setItem(preferenceKey, String(event.target.checked));
    if (!event.target.checked && !$('site-view').classList.contains('hidden')) returnToProjection();
  });
  $('mini-open').addEventListener('click', showMiniPlayer);
  $('mini-expand').addEventListener('click', returnToProjection);
  $('mini-back').addEventListener('click', returnToProjection);
  $('mini-minimize').addEventListener('click', () => {
    dom.youtubeContainer.classList.toggle('mini-minimized');
    syncMiniPlayer();
  });
  $('pip-open').addEventListener('click', openExternalPip);
  $('mini-pip').addEventListener('click', openExternalPip);
  $('pip-return').addEventListener('click', returnToProjection);
  $('pip-fullscreen').addEventListener('click', tryFullscreenForPip);
  $('pip-help-close').addEventListener('click', () => $('pip-help-dialog').close());
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    if (openSitePage(link.href)) event.preventDefault();
  }, true);
  $('site-frame').addEventListener('load', () => {
    try {
      const url = new URL($('site-frame').contentWindow.location.href);
      if (url.origin === location.origin && (url.pathname === '/' || url.pathname === '/index.html') && url.searchParams.get('sala') === state.roomId) returnToProjection();
    } catch { /* Pages outside this origin keep the original projection isolated. */ }
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== $('site-frame').contentWindow || event.data?.type !== 'floating-enter-room') return;
    const roomId = String(event.data.roomId || '');
    if (/^[a-z0-9_-]{1,50}$/.test(roomId)) openSitePage(`/index.html?sala=${encodeURIComponent(roomId)}`);
  });
  window.addEventListener('storage', event => {
    if (event.key === 'authToken' && !event.newValue) location.href = '/login.html';
  });
  bindDrag();
}
