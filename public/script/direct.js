const $ = id => document.getElementById(id);
const token = localStorage.getItem('authToken');
if (!token) location.replace('/login.html');
const shell = document.querySelector('.dm-shell');
const socket = io({ auth: { token } });
window.ChatNotificationBadge?.attachSocket(socket);
let conversations = [];
let selected = null;
let tab = 'chats';
let listPage = 1;
let before = null;
let currentSearch = '';
let currentSearchFilters = {};
let replyToId = null;
let currentUser = null;
let typingTimer = null;
let recorder = null;
let recordedChunks = [];
const mediaUrls = new Map();

async function request(path, options = {}) {
  const response = await fetch(`/api/direct${path}`, { ...options, headers: {
    Authorization: `Bearer ${token}`,
    ...(options.body instanceof FormData ? {} : options.body ? { 'Content-Type': 'application/json' } : {}),
  } });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('Servidor indisponível. Atualize a página.');
  const data = await response.json();
  if (response.status === 401) {
    localStorage.removeItem('authToken');
    location.replace('/login.html');
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
  return data;
}

function status(message, target = 'dm-chat-status') { $(target).textContent = message; }
function avatar(user) {
  const element = document.createElement('span'); element.className = 'dm-row-avatar';
  if (user.avatar) { const image = document.createElement('img'); image.src = user.avatar; image.alt = ''; element.append(image); }
  else element.textContent = user.username.slice(0, 1).toUpperCase();
  return element;
}
function readableType(message) {
  if (!message) return 'Nenhuma mensagem';
  if (message.deletedAt) return 'Mensagem excluída';
  return message.type === 'AUDIO' ? 'Áudio' : message.type === 'STICKER' ? 'Figurinha' :
    message.type === 'IMAGE' ? 'Imagem' : message.content;
}
async function loadConversations(append = false) {
  try {
    if (!append) listPage = 1;
    const query = new URLSearchParams({ archived: String(tab === 'archived'), search: $('dm-search').value, page: String(listPage) });
    const data = await request(`/conversations?${query}`);
    conversations = append ? [...conversations, ...data.conversations] : data.conversations;
    $('dm-list-more').classList.toggle('hidden', !data.hasMore);
    if (data.hasMore) listPage = data.nextPage;
    const incoming = conversations.filter(item => item.incomingRequest);
    $('dm-request-count').textContent = incoming.length ? `(${incoming.length})` : '';
    const shown = conversations.filter(item => tab === 'requests' ? item.incomingRequest : !item.incomingRequest);
    $('dm-list').replaceChildren();
    for (const conversation of shown) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'dm-row';
      button.classList.toggle('active', selected?.id === conversation.id);
      button.append(avatar(conversation.other));
      const body = document.createElement('span'); body.className = 'dm-row-body';
      const name = document.createElement('strong'); name.textContent = conversation.other.username;
      const preview = document.createElement('small'); preview.textContent = conversation.incomingRequest ? 'Solicitação de conversa' :
        conversation.outgoingRequest ? 'Aguardando resposta' : readableType(conversation.lastMessage);
      body.append(name, preview); button.append(body);
      if (conversation.unreadCount) { const badge = document.createElement('span'); badge.className = 'dm-badge'; badge.textContent = conversation.unreadCount; button.append(badge); }
      button.addEventListener('click', () => openConversation(conversation));
      $('dm-list').append(button);
    }
    status(shown.length ? '' : tab === 'requests' ? 'Nenhuma solicitação.' : 'Nenhuma conversa aqui.', 'dm-list-status');
  } catch (error) { status(error.message, 'dm-list-status'); }
}

async function assetUrl(id) {
  if (!mediaUrls.has(id)) mediaUrls.set(id, (async () => {
    const response = await fetch(`/api/direct/media/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Anexo indisponível.');
    return URL.createObjectURL(await response.blob());
  })());
  return mediaUrls.get(id);
}
function setReply(message) {
  replyToId = message.id;
  $('dm-reply-label').textContent = `Respondendo a ${message.sender.username}: ${readableType(message).slice(0, 60)}`;
  $('dm-reply').classList.remove('hidden'); $('dm-input').focus();
}
function clearReply() { replyToId = null; $('dm-reply').classList.add('hidden'); }

function renderMessage(message, prepend = false) {
  if ($('dm-messages').querySelector(`[data-id="${CSS.escape(message.id)}"]`)) return;
  const element = document.createElement('article'); element.className = 'dm-message'; element.dataset.id = message.id;
  const mine = message.senderId === currentUser.id; element.classList.toggle('mine', mine);
  const meta = document.createElement('div'); meta.className = 'dm-message-meta';
  const name = document.createElement('strong'); name.textContent = message.sender.username;
  const date = document.createElement('time'); date.textContent = new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  meta.append(name, date);
  if (mine && !message.deletedAt) { const delivery = document.createElement('span');
    delivery.textContent = message.readAt ? 'Lido' : message.deliveredAt ? 'Entregue' : 'Enviado'; meta.append(delivery); }
  element.append(meta);
  if (message.replyTo) { const quote = document.createElement('small'); quote.textContent = `↳ ${message.replyTo.deletedAt ? 'Mensagem excluída' : message.replyTo.content || readableType(message.replyTo)}`; element.append(quote); }
  if (message.deletedAt) { const deleted = document.createElement('i'); deleted.textContent = 'Mensagem excluída'; element.append(deleted); }
  else if (message.type === 'TEXT') { const text = document.createElement('p'); text.textContent = message.content; element.append(text); }
  else {
    const file = message.type === 'AUDIO' ? document.createElement('audio') : document.createElement('img');
    if (message.type === 'AUDIO') file.controls = true;
    else file.alt = message.type === 'STICKER' ? 'Figurinha' : 'Imagem enviada';
    assetUrl(message.mediaId).then(url => { file.src = url; }).catch(() => { file.replaceWith(document.createTextNode('Anexo indisponível')); });
    element.append(file);
  }
  if (!message.deletedAt) {
    const actions = document.createElement('div'); actions.className = 'dm-message-actions';
    const respond = document.createElement('button'); respond.type = 'button'; respond.textContent = 'Responder'; respond.addEventListener('click', () => setReply(message)); actions.append(respond);
    for (const emoji of ['❤️', '😂', '👍']) {
      const react = document.createElement('button'); react.type = 'button'; react.textContent = emoji;
      react.addEventListener('click', async () => { try { await request(`/messages/${message.id}/reaction`, { method: 'PUT', body: JSON.stringify({ emoji }) }); } catch (error) { status(error.message); } });
      actions.append(react);
    }
    if (mine) { const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Excluir';
      remove.addEventListener('click', async () => { try { await request(`/messages/${message.id}`, { method: 'DELETE' }); } catch (error) { status(error.message); } }); actions.append(remove); }
    element.append(actions);
  }
  if (message.reactions?.length) { const reactions = document.createElement('small'); reactions.className = 'dm-reactions'; reactions.textContent = message.reactions.map(item => item.emoji).join(' '); element.append(reactions); }
  let touchX = null;
  element.addEventListener('touchstart', event => { touchX = event.touches[0]?.clientX; }, { passive: true });
  element.addEventListener('touchend', event => { if (touchX !== null && event.changedTouches[0].clientX - touchX > 65 && !message.deletedAt) setReply(message); touchX = null; });
  if (prepend) $('dm-messages').prepend(element); else $('dm-messages').append(element);
}

async function loadMessages(reset = false) {
  if (!selected) return;
  const id = selected.id;
  try {
    if (reset) { before = null; $('dm-messages').replaceChildren(); }
    const query = new URLSearchParams({ ...(before ? { before } : {}), ...(currentSearch ? { search: currentSearch } : {}), ...currentSearchFilters });
    const data = await request(`/conversations/${id}/messages?${query}`);
    if (selected?.id !== id) return;
    for (const message of reset ? data.messages : [...data.messages].reverse()) renderMessage(message, !reset);
    before = data.messages[0]?.id || before;
    $('dm-more-messages').classList.toggle('hidden', !data.hasMore);
    if (reset) $('dm-messages').scrollTop = $('dm-messages').scrollHeight;
    loadConversations();
  } catch (error) { status(error.message); }
}
async function openConversation(conversation) {
  selected = conversation; currentSearch = ''; currentSearchFilters = {}; $('dm-message-search').classList.add('hidden');
  $('dm-message-search').reset(); shell.classList.add('chat-open'); clearReply();
  $('dm-empty').classList.add('hidden'); $('dm-conversation').classList.remove('hidden');
  $('dm-person').textContent = conversation.other.username;
  $('dm-person').href = `/perfil.html?id=${encodeURIComponent(conversation.other.id)}`;
  $('dm-person-status').textContent = conversation.other.presenceStatus === 'INVISIBLE' ? '' :
    conversation.other.statusText || ({ ONLINE: 'Online', AWAY: 'Ausente', BUSY: 'Ocupado' }[conversation.other.presenceStatus] || '');
  $('dm-request-actions').classList.toggle('hidden', !conversation.incomingRequest);
  $('dm-compose').classList.toggle('hidden', conversation.incomingRequest || conversation.status === 'DECLINED');
  $('dm-options').classList.add('hidden'); $('dm-more').setAttribute('aria-expanded', 'false');
  for (const [key, labels] of Object.entries({ muted: ['Silenciar', 'Ativar som'], pinned: ['Fixar', 'Desafixar'], archived: ['Arquivar', 'Desarquivar'] })) {
    document.querySelector(`[data-setting="${key}"]`).textContent = labels[Number(Boolean(conversation.settings[key]))];
  }
  status(''); await loadMessages(true);
}

async function sendMessage(type, content = '', mediaId = null) {
  if (!selected) return;
  const result = await request(`/conversations/${selected.id}/messages`, { method: 'POST', body: JSON.stringify({ type, content, mediaId, replyToId }) });
  renderMessage(result.message); $('dm-messages').scrollTop = $('dm-messages').scrollHeight; clearReply();
  socket.emit('direct-typing', { conversationId: selected.id, typing: false });
  loadConversations();
}
async function uploadFile(file, type) {
  if (!selected || !file) return;
  const form = new FormData(); form.append('type', type); form.append('file', file);
  const { asset } = await request(`/conversations/${selected.id}/media`, { method: 'POST', body: form });
  await sendMessage(type, '', asset.id);
}

async function loadSettings() {
  try {
    const { settings } = await request('/settings');
    $('dm-privacy').value = settings.directPrivacy; $('dm-presence').value = settings.presenceStatus; $('dm-status-text').value = settings.statusText || '';
    const { users } = await request('/blocks'); $('dm-blocks').replaceChildren();
    for (const user of users) { const row = document.createElement('div'); const name = document.createElement('span'); name.textContent = user.username;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Desbloquear';
      button.addEventListener('click', async () => { try { await request(`/blocks/${user.id}`, { method: 'DELETE' }); loadSettings(); } catch (error) { status(error.message, 'dm-settings-status'); } });
      row.append(name, button); $('dm-blocks').append(row); }
  } catch (error) { status(error.message, 'dm-settings-status'); }
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  tab = button.dataset.tab; document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button)); loadConversations();
}));
$('dm-list-more').addEventListener('click', () => loadConversations(true));
$('dm-search').addEventListener('input', () => { clearTimeout($('dm-search').timer); $('dm-search').timer = setTimeout(loadConversations, 250); });
$('dm-back').addEventListener('click', () => shell.classList.remove('chat-open'));
$('dm-more').addEventListener('click', () => { const open = $('dm-options').classList.toggle('hidden') === false; $('dm-more').setAttribute('aria-expanded', String(open)); });
$('dm-more-messages').addEventListener('click', () => loadMessages());
$('dm-search-messages').addEventListener('click', () => {
  if (!selected) return;
  $('dm-options').classList.add('hidden'); $('dm-more').setAttribute('aria-expanded', 'false');
  const open = $('dm-message-search').classList.toggle('hidden') === false;
  if (open) $('dm-message-search-text').focus();
});
$('dm-message-search').addEventListener('submit', async event => {
  event.preventDefault(); currentSearch = $('dm-message-search-text').value.trim().slice(0, 100);
  currentSearchFilters = {};
  for (const [key, id] of [['author', 'dm-message-search-author'], ['type', 'dm-message-search-type']])
    if ($(id).value) currentSearchFilters[key] = $(id).value;
  for (const [key, id, time] of [['from', 'dm-message-search-from', 'T00:00:00'], ['to', 'dm-message-search-to', 'T23:59:59.999']])
    if ($(id).value) currentSearchFilters[key] = new Date(`${$(id).value}${time}`).toISOString();
  await loadMessages(true); status('Resultados da busca nesta conversa.');
});
$('dm-message-search-clear').addEventListener('click', async () => {
  $('dm-message-search').reset(); currentSearch = ''; currentSearchFilters = {};
  await loadMessages(true); status('Histórico completo.');
});
$('dm-reply-cancel').addEventListener('click', clearReply);
$('dm-compose').addEventListener('submit', async event => { event.preventDefault(); const input = $('dm-input'); const content = input.value.trim(); if (!content) return;
  try { await sendMessage('TEXT', content); input.value = ''; } catch (error) { status(error.message); } });
$('dm-input').addEventListener('input', () => { if (!selected) return; socket.emit('direct-typing', { conversationId: selected.id, typing: true });
  clearTimeout(typingTimer); typingTimer = setTimeout(() => socket.emit('direct-typing', { conversationId: selected.id, typing: false }), 1400); });
$('dm-image').addEventListener('change', async event => { try { await uploadFile(event.target.files[0], 'IMAGE'); } catch (error) { status(error.message); } event.target.value = ''; });
$('dm-record').addEventListener('click', async () => {
  if (recorder) { recorder.stop(); return; }
  try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); recordedChunks = [];
    recorder = new MediaRecorder(stream); recorder.addEventListener('dataavailable', event => { if (event.data.size) recordedChunks.push(event.data); });
    recorder.addEventListener('stop', async () => { stream.getTracks().forEach(track => track.stop()); const blob = new Blob(recordedChunks, { type: recorder.mimeType }); recorder = null;
      $('dm-record').textContent = '🎙'; try { await uploadFile(blob, 'AUDIO'); } catch (error) { status(error.message); } });
    recorder.start(); $('dm-record').textContent = '■'; setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 120000);
  } catch (error) { status(error.message); }
});
$('dm-sticker-open').addEventListener('click', async () => {
  $('dm-stickers').showModal(); $('dm-sticker-grid').replaceChildren();
  try { const response = await fetch('/api/chat/stickers?page=1', { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json(); if (!response.ok) throw new Error(data.message);
    for (const sticker of data.stickers) { const button = document.createElement('button'); button.type = 'button'; button.title = sticker.name;
      const image = document.createElement('img'); image.alt = sticker.name;
      fetch(`/api/chat/media/${encodeURIComponent(sticker.assetId)}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(response => response.blob()).then(blob => { image.src = URL.createObjectURL(blob); }).catch(() => {}); button.append(image);
      button.addEventListener('click', async () => { try { await sendMessage('STICKER', '', sticker.assetId); $('dm-stickers').close(); } catch (error) { status(error.message, 'dm-sticker-status'); } }); $('dm-sticker-grid').append(button); }
    if (!data.stickers.length) status('Nenhuma figurinha na sua biblioteca.', 'dm-sticker-status');
  } catch (error) { status(error.message, 'dm-sticker-status'); }
});
$('dm-settings-open').addEventListener('click', () => { $('dm-settings').showModal(); loadSettings(); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('dm-settings-save').addEventListener('click', async () => { try { await request('/settings', { method: 'PATCH', body: JSON.stringify({ directPrivacy: $('dm-privacy').value,
  presenceStatus: $('dm-presence').value, statusText: $('dm-status-text').value }) }); status('Preferências salvas.', 'dm-settings-status'); } catch (error) { status(error.message, 'dm-settings-status'); } });
document.querySelectorAll('[data-setting]').forEach(button => button.addEventListener('click', async () => {
  if (!selected) return; const key = button.dataset.setting; try { const result = await request(`/conversations/${selected.id}/settings`, { method: 'PATCH',
    body: JSON.stringify({ [key]: !selected.settings[key] }) }); selected.settings = result.settings; status('Preferência atualizada.'); loadConversations(); }
  catch (error) { status(error.message); }
}));
async function blockSelected() { if (!selected || !confirm(`Bloquear ${selected.other.username}?`)) return;
  try { await request(`/blocks/${selected.other.id}`, { method: 'PUT' }); shell.classList.remove('chat-open'); selected = null; loadConversations(); status('Usuário bloqueado.', 'dm-list-status'); }
  catch (error) { status(error.message); } }
$('dm-block').addEventListener('click', blockSelected); $('dm-request-block').addEventListener('click', blockSelected);
for (const [id, action] of [['dm-accept', 'accept'], ['dm-decline', 'decline']]) $(id).addEventListener('click', async () => {
  try { await request(`/conversations/${selected.id}/request`, { method: 'PATCH', body: JSON.stringify({ action }) });
    if (action === 'decline') { shell.classList.remove('chat-open'); selected = null; }
    else { selected.incomingRequest = false; selected.status = 'ACTIVE'; openConversation(selected); }
    loadConversations(); } catch (error) { status(error.message); }
});
$('dm-request-report').addEventListener('click', () => $('dm-report').showModal());
$('dm-report-open').addEventListener('click', () => $('dm-report').showModal());
$('dm-report-send').addEventListener('click', async () => {
  if (!selected) return;
  try { await request(`/conversations/${selected.id}/report`, { method: 'POST', body: JSON.stringify({
    reason: $('dm-report-reason').value, details: $('dm-report-details').value,
  }) }); $('dm-report').close(); status('Denúncia registrada. Obrigado por avisar.'); }
  catch (error) { status(error.message, 'dm-report-status'); }
});
socket.on('direct-updated', loadConversations);
socket.on('direct-message', message => { if (selected?.id === message.conversationId) { renderMessage(message); $('dm-messages').scrollTop = $('dm-messages').scrollHeight; }
  loadConversations(); });
socket.on('direct-deleted', payload => { if (selected?.id === payload.conversationId) loadMessages(true); loadConversations(); });
socket.on('direct-reactions', payload => { if (selected?.id === payload.conversationId) loadMessages(true); });
socket.on('direct-read', payload => { if (selected?.id === payload.conversationId) loadMessages(true); });
socket.on('direct-delivered', () => { if (selected) loadMessages(true); });
socket.on('direct-typing', payload => { if (selected?.id === payload.conversationId) { $('dm-typing').textContent = payload.typing ? `${selected.other.username} está digitando...` : ''; } });
socket.on('account-deleted', () => { localStorage.removeItem('authToken'); location.replace('/login.html'); });
socket.on('connect_error', error => {
  if (error.data?.code === 'AUTH_INVALID') {
    localStorage.removeItem('authToken'); location.replace('/login.html'); return;
  }
  status(error.message || 'Conexão temporariamente indisponível. Tente novamente.');
});
try { const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json();
  if (!response.ok) throw new Error(data.message); currentUser = data.user;
  await loadConversations(); const params = new URLSearchParams(location.search);
  const conversationId = params.get('conversation');
  if (conversationId) {
    const result = await request(`/conversations/${encodeURIComponent(conversationId)}`);
    await openConversation(result.conversation);
    const messageId = params.get('message');
    if (messageId) $('dm-messages').querySelector(`[data-id="${CSS.escape(messageId)}"]`)?.scrollIntoView({ block: 'center' });
  }
  const userId = params.get('user');
  if (userId) { const { conversation } = await request('/conversations', { method: 'POST', body: JSON.stringify({ userId }) });
    await loadConversations(); const found = conversations.find(item => item.id === conversation.id); if (found) openConversation(found); }
} catch (error) { status(error.message, 'dm-list-status'); }

function syncViewport() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--dm-viewport-height', `${height}px`);
  document.body.classList.toggle('keyboard-open', window.innerHeight - height > 140);
}
window.visualViewport?.addEventListener('resize', syncViewport);
window.addEventListener('resize', syncViewport);
syncViewport();
