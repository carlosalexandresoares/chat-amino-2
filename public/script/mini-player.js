import state from './state.js';
import dom from './dom.js';

const $ = id => document.getElementById(id);
const preferenceKey = 'floatingVideoEnabled';
const allowedPages = new Set(['/index.html', '/', '/perfil.html', '/editar-perfil.html', '/communities.html', '/room.html', '/admin.html']);
let initialized = false;
let noticeTimer;

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
  $('mini-minimize').textContent = player.classList.contains('mini-minimized') ? 'Mostrar vídeo' : 'Minimizar';
}

export function showMiniPlayer() {
  if (!state.liveActive || !dom.youtubeContainer.classList.contains('active')) return;
  dom.youtubeContainer.classList.add('mini-mode');
  dom.youtubeContainer.classList.remove('mini-minimized');
  syncMiniPlayer();
}

export function hideMiniPlayer() {
  dom.youtubeContainer.classList.remove('mini-mode', 'mini-minimized');
  resetPosition();
  syncMiniPlayer();
}

export function returnToProjection() {
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
  const wasFloating = dom.youtubeContainer.classList.contains('mini-mode');
  if (!$('site-view').classList.contains('hidden')) returnToProjection();
  else hideMiniPlayer();
  if (wasFloating) notify('A projeção foi encerrada pelo host.');
}

function explainPip() {
  notify('O PiP nativo não pode ser iniciado por este site para o iframe do YouTube. Use o mini player dentro do site ou os controles oferecidos pelo navegador.');
  showMiniPlayer();
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
  $('pip-open').addEventListener('click', explainPip);
  $('mini-pip').addEventListener('click', explainPip);
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
