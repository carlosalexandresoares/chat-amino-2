import state from './state.js';
import dom from './dom.js';
import { initializeWallpaper } from './wallpaper.js?v=2';

const $ = id => document.getElementById(id);
const mediaUrls = new Map();
const renderedMessages = new WeakMap();
const swipeReturnTimers = new WeakMap();
const SWIPE_REPLY_THRESHOLD = 60;
const SWIPE_REPLY_MAX = 88;
let swipeInitialized = false;
let renderMessage;
let reply = null;
let activeMenu = null;
let recorder = null;
let stream = null;
let chunks = [];
let recordedBlob = null;
let audioUploadId = null;
let audioClientKey = null;
let previewUrl = null;
let recordingStarted = 0;
let timer = null;
let recordingLimit = null;
let stickerTab = 'all';
let stickerPage = 1;
let stickerMore = false;
let stickerFile = null;
let stickerPreviewUrl = null;
let historyMore = true;
let historyLoading = false;
let maxAudioSeconds = 120;
let uploadsAvailable = true;

async function api(path, options = {}) {
  const response = await fetch(`/api/chat${path}`, { ...options,
    headers: { Authorization: `Bearer ${state.token}`,
      ...(options.body instanceof FormData ? {} : options.body ? { 'Content-Type': 'application/json' } : {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
  return data;
}

async function assetUrl(id) {
  if (!mediaUrls.has(id)) mediaUrls.set(id, (async () => {
    const response = await fetch(`/api/chat/media/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) throw new Error('Arquivo indisponível.');
    return URL.createObjectURL(await response.blob());
  })());
  return mediaUrls.get(id);
}

const lazyMedia = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    lazyMedia.unobserve(entry.target);
    const id = entry.target.dataset.mediaId;
    if (entry.target.tagName === 'IMG') assetUrl(id).then(url => { entry.target.src = url; }).catch(() => { entry.target.alt = 'Figurinha indisponível'; });
  }
}, { rootMargin: '250px' });

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function startReply(data) {
  reply = data;
  $('reply-composer-text').textContent = `Respondendo a ${data.user.username}: ${data.type === 'AUDIO' ? 'Áudio' : data.type === 'STICKER' ? 'Figurinha' : data.message.slice(0, 100)}`;
  $('reply-composer').classList.remove('hidden');
  dom.input.focus();
}
export function replyToId() { return reply?.id || null; }
export function clearReply() { reply = null; $('reply-composer').classList.add('hidden'); }

function initializeSwipeReply() {
  if (swipeInitialized) return;
  swipeInitialized = true;
  let gesture = null;
  const interactive = 'button, a, input, select, textarea, audio, video, [contenteditable], .message-actions';

  function restore(activate = false) {
    if (!gesture) return;
    const { element, data, indicator, distance } = gesture;
    gesture = null;
    indicator?.remove();
    if (element.isConnected) {
      element.classList.remove('swiping');
      element.classList.add('swipe-returning');
      element.style.transform = '';
      const timer = setTimeout(() => {
        element.classList.remove('swipe-returning');
        swipeReturnTimers.delete(element);
      }, 220);
      swipeReturnTimers.set(element, timer);
    }
    if (activate && distance >= SWIPE_REPLY_THRESHOLD && element.isConnected && !data.deleted) startReply(data);
  }

  dom.messages.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (!event.isPrimary || event.button !== 0 || event.target.closest(interactive)) return;
    const element = event.target.closest('.message');
    if (!element || !dom.messages.contains(element)) return;
    const data = renderedMessages.get(element);
    if (!data || data.deleted) return;
    restore();
    clearTimeout(swipeReturnTimers.get(element));
    element.classList.remove('swipe-returning');
    gesture = { element, data, pointerId: event.pointerId, startX: event.clientX,
      startY: event.clientY, direction: null, distance: 0, vibrated: false, indicator: null };
  });

  window.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.direction) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) { restore(); return; }
      gesture.direction = 'horizontal';
      gesture.element.classList.add('swiping');
      closeMenu();
      const indicator = document.createElement('span');
      indicator.className = 'reply-swipe-indicator';
      indicator.textContent = '↩';
      indicator.setAttribute('aria-hidden', 'true');
      const rect = gesture.element.getBoundingClientRect();
      indicator.style.left = `${Math.max(8, rect.left - 40)}px`;
      indicator.style.top = `${rect.top + rect.height / 2}px`;
      document.body.append(indicator);
      gesture.indicator = indicator;
    }
    if (Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 24) { restore(); return; }
    if (event.cancelable) event.preventDefault();
    gesture.distance = Math.max(0, Math.min(SWIPE_REPLY_MAX, dx));
    gesture.element.style.transform = `translate3d(${gesture.distance}px, 0, 0)`;
    gesture.indicator.style.setProperty('--swipe-progress', String(Math.min(1, gesture.distance / SWIPE_REPLY_THRESHOLD)));
    const ready = gesture.distance >= SWIPE_REPLY_THRESHOLD;
    gesture.indicator.classList.toggle('ready', ready);
    if (ready && !gesture.vibrated) {
      gesture.vibrated = true;
      navigator.vibrate?.(10);
    }
  }, { passive: false });
  window.addEventListener('pointerup', event => {
    if (gesture && event.pointerId === gesture.pointerId) restore(true);
  });
  window.addEventListener('pointercancel', event => {
    if (gesture && event.pointerId === gesture.pointerId) restore();
  });
  window.addEventListener('blur', () => restore());
}

async function navigateTo(id) {
  let target = [...dom.messages.querySelectorAll('.message')].find(element => element.dataset.messageId === id);
  if (!target) {
    try {
      const data = await api(`/messages/${encodeURIComponent(id)}/context`);
      for (const message of data.messages.reverse()) renderMessage(message, { prepend: true });
      target = [...dom.messages.querySelectorAll('.message')].find(element => element.dataset.messageId === id);
    } catch (error) { window.alert(error.message); return; }
  }
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.classList.add('highlight-original');
  setTimeout(() => target?.classList.remove('highlight-original'), 2200);
}

function updateReactions(element, reactions = []) {
  element.querySelector('.message-reactions')?.remove();
  if (!reactions.length) return;
  const group = document.createElement('div'); group.className = 'message-reactions';
  const counts = new Map();
  for (const item of reactions) counts.set(item.emoji, (counts.get(item.emoji) || 0) + 1);
  for (const [emoji, count] of counts) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${emoji} ${count}`;
    button.title = 'Reagir'; button.addEventListener('click', () => react(element.dataset.messageId, emoji));
    group.append(button);
  }
  element.append(group);
}

async function react(id, emoji) {
  try { await api(`/messages/${encodeURIComponent(id)}/reaction`, { method: 'PUT', body: JSON.stringify({ emoji }) }); }
  catch (error) { window.alert(error.message); }
}

function audioPlayer(data) {
  const player = document.createElement('div'); player.className = 'message-audio';
  const play = document.createElement('button'); play.type = 'button'; play.textContent = '▶'; play.setAttribute('aria-label', 'Reproduzir áudio');
  const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.setAttribute('aria-label', 'Progresso do áudio');
  const time = document.createElement('span'); time.textContent = formatTime(data.media?.duration);
  const speed = document.createElement('button'); speed.type = 'button'; speed.textContent = '1x'; speed.setAttribute('aria-label', 'Velocidade do áudio');
  const wave = document.createElement('div'); wave.className = 'wave'; wave.setAttribute('aria-hidden', 'true');
  const audio = document.createElement('audio'); audio.preload = 'none';
  let loaded = false;
  play.addEventListener('click', async () => {
    try {
      if (!loaded) { audio.src = await assetUrl(data.mediaId); loaded = true; }
      if (audio.paused) await audio.play(); else audio.pause();
    } catch (error) { time.textContent = error.message; }
  });
  audio.addEventListener('play', () => { play.textContent = '❚❚'; play.setAttribute('aria-label', 'Pausar áudio'); });
  audio.addEventListener('pause', () => { play.textContent = '▶'; play.setAttribute('aria-label', 'Continuar áudio'); });
  audio.addEventListener('timeupdate', () => {
    seek.value = String(Math.round(audio.currentTime / (audio.duration || data.media?.duration || 1) * 1000));
    time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration || data.media?.duration)}`;
  });
  seek.addEventListener('input', () => { if (audio.duration) audio.currentTime = Number(seek.value) / 1000 * audio.duration; });
  speed.addEventListener('click', () => {
    const next = audio.playbackRate === 1 ? 1.5 : audio.playbackRate === 1.5 ? 2 : 1;
    audio.playbackRate = next; speed.textContent = `${next}x`;
  });
  player.append(play, seek, time, speed, wave, audio);
  return player;
}

function closeMenu() { activeMenu?.remove(); activeMenu = null; }
function openMenu(element, data) {
  closeMenu();
  const menu = document.createElement('div'); menu.className = 'message-actions'; activeMenu = menu;
  const action = (label, callback) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => { closeMenu(); callback(); }); menu.append(button);
  };
  if (!data.deleted) action('Responder', () => startReply(data));
  if (data.type === 'TEXT' && !data.deleted) action('Copiar texto', () => navigator.clipboard.writeText(data.message).catch(() => {}));
  if (!data.deleted) for (const emoji of ['❤️', '😂', '👍', '😮', '😢', '🔥']) action(`Reagir ${emoji}`, () => react(data.id, emoji));
  if ((data.user.id === state.currentUser?.id || state.currentUser?.isSiteAdmin) && !data.deleted) action('Excluir mensagem', async () => {
    if (!confirm('Excluir esta mensagem?')) return;
    try { await api(`/messages/${encodeURIComponent(data.id)}`, { method: 'DELETE' }); }
    catch (error) { window.alert(error.message); }
  });
  action('Informações', () => window.alert(`${data.user.username} · ${new Date(data.createdAt).toLocaleString('pt-BR')} · ${data.type || 'TEXT'}`));
  element.append(menu);
}

export function enhanceMessage(element, data, header, content) {
  renderedMessages.set(element, data);
  if (data.deleted) { content.textContent = 'Mensagem indisponível'; element.classList.add('deleted-message'); }
  else if (data.type === 'AUDIO' && data.mediaId) {
    element.classList.add('audio-message');
    content.replaceWith(audioPlayer(data));
  }
  else if (data.type === 'STICKER' && data.mediaId) {
    const img = document.createElement('img'); img.className = 'message-sticker'; img.alt = 'Figurinha'; img.dataset.mediaId = data.mediaId;
    content.replaceWith(img); lazyMedia.observe(img); element.classList.add('sticker-message');
  }
  if (data.replyTo) {
    const quote = document.createElement('button'); quote.type = 'button'; quote.className = 'message-reply';
    const name = document.createElement('strong'); name.textContent = data.replyTo.user || 'Mensagem anterior';
    const preview = document.createElement('span'); preview.textContent = data.replyTo.message;
    quote.append(name, preview); quote.addEventListener('click', () => navigateTo(data.replyTo.id));
    element.insertBefore(quote, element.children[1]); element.classList.add('reply-message');
  }
  const button = document.createElement('button'); button.type = 'button'; button.className = 'message-menu-button';
  button.textContent = '⋯'; button.setAttribute('aria-label', 'Ações da mensagem');
  button.addEventListener('click', () => activeMenu?.parentElement === element ? closeMenu() : openMenu(element, data));
  header.append(button);
  element.addEventListener('contextmenu', event => {
    if (event.target.closest('button, input, audio, a')) return;
    event.preventDefault(); openMenu(element, data);
  });
  let hold;
  element.addEventListener('touchstart', event => {
    if (event.target.closest('button, input, audio, a')) return;
    hold = setTimeout(() => openMenu(element, data), 550);
  }, { passive: true });
  for (const type of ['touchend', 'touchcancel', 'touchmove']) element.addEventListener(type, () => clearTimeout(hold), { passive: true });
  updateReactions(element, data.reactions);
}

function resetRecorder() {
  clearInterval(timer); clearTimeout(recordingLimit);
  if (recorder?.state === 'recording') recorder.stop();
  stream?.getTracks().forEach(track => track.stop());
  recorder = null; stream = null; chunks = []; recordedBlob = null;
  audioUploadId = null; audioClientKey = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null; $('audio-preview').src = ''; $('audio-preview').classList.add('hidden');
  $('audio-compose').classList.add('hidden'); $('audio-send').classList.add('hidden');
}

async function startRecording() {
  resetRecorder();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { window.alert('Seu navegador não oferece gravação de áudio.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const activeRecorder = recorder;
    chunks = []; recordingStarted = Date.now();
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stream?.getTracks().forEach(track => track.stop()); stream = null;
      if (!$('audio-compose').classList.contains('hidden') && chunks.length) {
        recordedBlob = new Blob(chunks, { type: activeRecorder.mimeType || chunks[0].type });
        previewUrl = URL.createObjectURL(recordedBlob);
        $('audio-preview').src = previewUrl; $('audio-preview').classList.remove('hidden');
        $('audio-send').classList.remove('hidden'); $('audio-status').textContent = 'Ouça antes de enviar';
      }
    };
    recorder.start(1000); $('audio-compose').classList.remove('hidden'); $('audio-status').textContent = 'Gravando...';
    $('audio-timer').textContent = '0:00';
    timer = setInterval(() => { $('audio-timer').textContent = formatTime((Date.now() - recordingStarted) / 1000); }, 250);
    recordingLimit = setTimeout(stopRecording, maxAudioSeconds * 1000);
    $('record-audio').textContent = '■'; $('record-audio').setAttribute('aria-label', 'Parar gravação');
  } catch { window.alert('Não foi possível acessar o microfone. Verifique a permissão do navegador.'); resetRecorder(); }
}
function stopRecording() {
  clearInterval(timer); clearTimeout(recordingLimit);
  if (recorder?.state === 'recording') recorder.stop();
  $('record-audio').textContent = '🎙'; $('record-audio').setAttribute('aria-label', 'Gravar áudio');
}

function emitMedia(payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tempo esgotado ao enviar mensagem.')), 12000);
    state.socket.emit('chat-media-message', { roomId: state.roomId, replyToId: replyToId(), clientKey: crypto.randomUUID(), ...payload }, result => {
      clearTimeout(timeout); result?.success ? resolve(result) : reject(new Error(result?.message || 'Não foi possível enviar a mensagem.'));
    });
  });
}

async function sendAudio() {
  if (!recordedBlob || !state.socket.connected) return;
  const button = $('audio-send'); button.disabled = true;
  try {
    audioClientKey ||= crypto.randomUUID();
    if (!audioUploadId) {
      const form = new FormData(); form.append('roomId', state.roomId);
      form.append('file', recordedBlob, recordedBlob.type.includes('mp4') ? 'voz.m4a' : 'voz.webm');
      const uploaded = await api('/audio', { method: 'POST', body: form });
      audioUploadId = uploaded.id;
    }
    await emitMedia({ type: 'AUDIO', mediaId: audioUploadId, clientKey: audioClientKey });
    resetRecorder(); clearReply();
  } catch (error) { $('audio-status').textContent = error.message; }
  finally { button.disabled = false; }
}

async function loadStickers(reset = false) {
  if (reset) { stickerPage = 1; $('sticker-grid').replaceChildren(); }
  try {
    const query = new URLSearchParams({ tab: stickerTab, page: stickerPage, search: $('sticker-search').value,
      ...( $('sticker-pack').value ? { packId: $('sticker-pack').value } : {}) });
    const data = await api(`/stickers?${query}`);
    for (const sticker of data.stickers) {
      const tile = document.createElement('div'); tile.className = 'sticker-tile';
      const send = document.createElement('button'); send.type = 'button'; send.title = `Enviar ${sticker.name}`;
      const img = document.createElement('img'); img.alt = sticker.name; img.dataset.mediaId = sticker.assetId;
      send.append(img); lazyMedia.observe(img);
      send.addEventListener('click', async () => {
        try { await emitMedia({ type: 'STICKER', stickerId: sticker.id }); clearReply(); $('sticker-panel').classList.add('hidden'); }
        catch (error) { $('sticker-status').textContent = error.message; }
      });
      const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'favorite';
      favorite.textContent = sticker.favorite ? '♥' : '♡'; favorite.setAttribute('aria-label', sticker.favorite ? 'Remover dos favoritos' : 'Favoritar');
      favorite.addEventListener('click', async () => {
        try { const result = await api(`/stickers/${sticker.id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite: !sticker.favorite }) });
          sticker.favorite = result.favorite; favorite.textContent = result.favorite ? '♥' : '♡'; }
        catch (error) { $('sticker-status').textContent = error.message; }
      });
      tile.append(send, favorite); $('sticker-grid').append(tile);
    }
    stickerMore = data.hasMore; $('sticker-more').classList.toggle('hidden', !stickerMore);
    if (reset && !data.stickers.length) $('sticker-status').textContent = uploadsAvailable
      ? 'Nenhuma figurinha encontrada. Crie a primeira abaixo.'
      : 'Nenhuma figurinha disponível. O armazenamento de arquivos ainda precisa ser configurado no servidor.';
    else $('sticker-status').textContent = '';
    stickerPage += 1;
  } catch (error) { $('sticker-status').textContent = error.message; }
}

async function loadPacks() {
  try {
    const data = await api('/sticker-packs'); const select = $('sticker-pack');
    const previous = select.value; select.replaceChildren(new Option('Todos os pacotes', ''));
    for (const pack of data.packs) select.add(new Option(pack.name, pack.id));
    select.value = previous;
  } catch (error) { $('sticker-status').textContent = error.message; }
}

export function initializeRichChat(addMessage) {
  renderMessage = addMessage;
  initializeSwipeReply();
  api('/config').then(config => {
    maxAudioSeconds = Number(config.maxAudioSeconds) || 120;
    uploadsAvailable = Boolean(config.uploadsAvailable);
    if (!uploadsAvailable) {
      $('record-audio').title = 'Envio de áudio aguarda configuração do armazenamento no servidor.';
      $('sticker-add').title = 'Criação de figurinhas aguarda configuração do armazenamento no servidor.';
      $('wallpaper-file').title = 'Imagem personalizada aguarda configuração do armazenamento no servidor.';
      $('record-audio').disabled = true;
      $('sticker-add').disabled = true;
      $('sticker-file').disabled = true;
      $('wallpaper-file').disabled = true;
    }
  }).catch(console.error);
  $('reply-cancel').addEventListener('click', clearReply);
  $('record-audio').addEventListener('click', () => recorder?.state === 'recording' ? stopRecording() : startRecording());
  $('audio-cancel').addEventListener('click', () => { resetRecorder(); $('record-audio').textContent = '🎙'; });
  $('audio-send').addEventListener('click', sendAudio);
  $('sticker-toggle').addEventListener('click', () => {
    const open = $('sticker-panel').classList.toggle('hidden') === false;
    if (open) { loadPacks(); loadStickers(true); }
  });
  $('sticker-close').addEventListener('click', () => $('sticker-panel').classList.add('hidden'));
  $('sticker-more').addEventListener('click', () => { if (stickerMore) loadStickers(); });
  $('sticker-search').addEventListener('input', () => { clearTimeout($('sticker-search').searchTimer); $('sticker-search').searchTimer = setTimeout(() => loadStickers(true), 250); });
  $('sticker-pack').addEventListener('change', () => loadStickers(true));
  document.querySelectorAll('[data-sticker-tab]').forEach(button => button.addEventListener('click', () => {
    stickerTab = button.dataset.stickerTab;
    document.querySelectorAll('[data-sticker-tab]').forEach(item => item.classList.toggle('active', item === button));
    loadStickers(true);
  }));
  $('sticker-add').addEventListener('click', () => $('sticker-file').click());
  $('sticker-file').addEventListener('change', () => {
    stickerFile = $('sticker-file').files[0]; if (!stickerFile) return;
    if (stickerPreviewUrl) URL.revokeObjectURL(stickerPreviewUrl);
    stickerPreviewUrl = URL.createObjectURL(stickerFile);
    $('sticker-preview-image').src = stickerPreviewUrl; $('sticker-preview').classList.remove('hidden');
  });
  const updateCrop = () => { $('sticker-preview-image').style.objectPosition = `${$('sticker-crop-x').value}% ${$('sticker-crop-y').value}%`; };
  $('sticker-crop-x').addEventListener('input', updateCrop); $('sticker-crop-y').addEventListener('input', updateCrop);
  $('sticker-save').addEventListener('click', async () => {
    if (!stickerFile) return;
    const button = $('sticker-save'); button.disabled = true;
    try {
      const form = new FormData(); form.append('file', stickerFile); form.append('name', $('sticker-name').value);
      form.append('cropX', $('sticker-crop-x').value); form.append('cropY', $('sticker-crop-y').value);
      if ($('sticker-pack').value) form.append('packId', $('sticker-pack').value);
      await api('/stickers', { method: 'POST', body: form });
      $('sticker-preview').classList.add('hidden'); $('sticker-file').value = ''; stickerFile = null;
      await loadStickers(true); $('sticker-status').textContent = 'Figurinha salva.';
    } catch (error) { $('sticker-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('sticker-create-pack').addEventListener('click', async () => {
    const name = prompt('Nome do novo pacote de figurinhas:'); if (!name) return;
    try { const result = await api('/sticker-packs', { method: 'POST', body: JSON.stringify({ name }) });
      await loadPacks(); $('sticker-pack').value = result.pack.id; await loadStickers(true); }
    catch (error) { $('sticker-status').textContent = error.message; }
  });
  document.addEventListener('click', event => { if (activeMenu && !event.target.closest('.message-actions, .message-menu-button')) closeMenu(); });
  state.socket.on('chat-reactions', ({ id, reactions }) => {
    const element = [...dom.messages.querySelectorAll('.message')].find(item => item.dataset.messageId === id);
    if (element) updateReactions(element, reactions);
  });
  state.socket.on('chat-message-deleted', ({ id }) => {
    const element = [...dom.messages.querySelectorAll('.message')].find(item => item.dataset.messageId === id);
    if (element) {
      element.querySelector('.message-audio, .message-sticker, .message-text')?.replaceWith(Object.assign(document.createElement('div'), { className: 'message-text', textContent: 'Mensagem indisponível' }));
      element.querySelector('.message-actions')?.remove();
      element.classList.add('deleted-message');
    }
    for (const response of dom.messages.querySelectorAll('.message[data-reply-to-id]')) {
      if (response.dataset.replyToId === id) {
        const preview = response.querySelector('.message-reply span');
        if (preview) preview.textContent = 'Mensagem indisponível';
      }
    }
  });
  dom.messages.addEventListener('scroll', async () => {
    if (dom.messages.scrollTop > 60 || historyLoading || !historyMore) return;
    const oldest = dom.messages.querySelector('.message'); if (!oldest?.dataset.messageId) return;
    historyLoading = true; const oldHeight = dom.messages.scrollHeight;
    try {
      const data = await api(`/rooms/${encodeURIComponent(state.roomId)}/messages?before=${encodeURIComponent(oldest.dataset.messageId)}`);
      for (const message of data.messages.reverse()) addMessage(message, { prepend: true });
      historyMore = data.hasMore; dom.messages.scrollTop = dom.messages.scrollHeight - oldHeight;
    } catch (error) { console.error(error); }
    finally { historyLoading = false; }
  });
  state.socket.on('chat-history', () => { historyMore = true; });
  initializeWallpaper(api, assetUrl, state.roomId);
}
