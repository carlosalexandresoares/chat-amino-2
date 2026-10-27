import state from './state.js';
import { fetchWithTimeout } from './request-timeout.js';
import { navigateTo } from './chat-rich.js?v=8';

const $ = id => document.getElementById(id);
const topicLabels = new Map();
let discoverPage = 1;
let discoverSeq = 0;
let pollCursor = null;
let pollSeq = 0;
let searchCursor = null;
let searchParams = null;
let activeTab = null;

async function api(path, options = {}) {
  const request = !options.method || options.method === 'GET' ? fetchWithTimeout : fetch;
  const response = await request(`/api/community${path}`, { ...options,
    headers: {
    Authorization: `Bearer ${state.token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
  return data;
}

export async function loadTopics() {
  const { topics } = await api('/topics');
  for (const { id, label } of topics) topicLabels.set(id, label);
  for (const id of ['room-topic', 'manage-room-topic', 'discover-topic']) {
    const select = $(id);
    select.replaceChildren();
    if (id === 'discover-topic') select.add(new Option('Todas as categorias', ''));
    for (const { id: code, label } of topics) select.add(new Option(label, code));
  }
  const { topics: selected } = await api('/interests');
  $('discover-interests-options').replaceChildren();
  for (const { id, label: name } of topics) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = id;
    checkbox.checked = selected.includes(id);
    label.append(checkbox, ` ${name}`); $('discover-interests-options').append(label);
  }
}

function renderRoom(room) {
  const card = document.createElement('article'); card.className = 'public-room-card community-card';
  const cover = document.createElement('div'); cover.className = 'public-room-cover';
  if (room.banner) cover.style.backgroundImage = `url("${room.banner.replaceAll('"', '%22')}")`;
  else cover.textContent = room.category || '💬';
  const body = document.createElement('div'); body.className = 'public-room-information';
  const heading = document.createElement('div'); heading.className = 'community-card-heading';
  const title = document.createElement('h2'); title.textContent = room.name;
  const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'favorite-room';
  const setFavorite = value => { favorite.textContent = value ? '★' : '☆'; favorite.setAttribute('aria-label',
    value ? `Remover ${room.name} das favoritas` : `Favoritar ${room.name}`); favorite.setAttribute('aria-pressed', String(value)); };
  setFavorite(room.isFavorite);
  favorite.addEventListener('click', async () => {
    favorite.disabled = true;
    try { await api(`/rooms/${encodeURIComponent(room.id)}/favorite`, { method: room.isFavorite ? 'DELETE' : 'PUT' });
      room.isFavorite = !room.isFavorite; setFavorite(room.isFavorite);
      if ($('discover-favorites').checked) {
        if (!room.isFavorite) card.remove();
        else await loadDiscover();
      } }
    catch (error) { $('rooms-total').textContent = error.message; }
    finally { favorite.disabled = false; }
  });
  heading.append(title, favorite);
  const topic = document.createElement('span'); topic.className = 'community-topic'; topic.textContent = topicLabels.get(room.topic) || 'Conversas gerais';
  if (room.interestMatch) topic.textContent += ' · Para você';
  const description = document.createElement('p'); description.textContent = room.description || 'Entre e participe da conversa.';
  const metrics = document.createElement('p'); metrics.className = 'room-card-counts';
  metrics.textContent = `${room.members} ${room.members === 1 ? 'participante' : 'participantes'} · ${room.onlineCount} online · ${room.growth} ${room.growth === 1 ? 'novo' : 'novos'} na semana`;
  const enter = document.createElement('button'); enter.type = 'button'; enter.className = 'enter-room-button';
  enter.textContent = room.isMember ? 'Abrir conversa' : 'Participar';
  enter.addEventListener('click', () => {
    const url = new URL('/index.html', location.origin); url.searchParams.set('sala', room.id); location.href = url.pathname + url.search;
  });
  body.append(heading, topic, description, metrics, enter); card.append(cover, body);
  return card;
}

export async function loadDiscover(reset = true) {
  const seq = ++discoverSeq;
  if (reset) { discoverPage = 1; $('public-rooms-grid').textContent = 'Buscando comunidades...'; }
  const query = new URLSearchParams({ page: String(discoverPage), sort: $('discover-sort').value });
  if ($('discover-search').value.trim()) query.set('search', $('discover-search').value.trim());
  if ($('discover-topic').value) query.set('topic', $('discover-topic').value);
  if ($('discover-favorites').checked) query.set('favorites', 'true');
  $('discover-more').disabled = true;
  try {
    const { rooms, hasMore } = await api(`/discover?${query}`);
    if (seq !== discoverSeq) return;
    if (reset) $('public-rooms-grid').replaceChildren();
    for (const room of rooms) $('public-rooms-grid').append(renderRoom(room));
    if (!$('public-rooms-grid').childElementCount) $('public-rooms-grid').textContent = 'Nenhuma comunidade encontrada.';
    const count = $('public-rooms-grid').querySelectorAll('.community-card').length;
    $('rooms-total').textContent = `${count}${hasMore ? '+' : ''} ${count === 1 ? 'comunidade' : 'comunidades'}`;
    $('discover-more').classList.toggle('hidden', !hasMore);
    if (hasMore) discoverPage++;
  } catch (error) {
    if (seq === discoverSeq) {
      $('public-rooms-grid').textContent = error.name === 'TimeoutError'
        ? 'A conexão demorou. Toque em Explorar para tentar novamente.' : error.message;
      $('rooms-total').textContent = 'Não foi possível carregar';
    }
  }
  finally { $('discover-more').disabled = false; }
}

async function loadPins() {
  if (!state.roomId) return;
  try {
    const { pins } = await api(`/rooms/${encodeURIComponent(state.roomId)}/pins`);
    $('community-pin-list').replaceChildren();
    for (const pin of pins) {
      const row = document.createElement('div'); row.className = 'community-result';
      const go = document.createElement('button'); go.type = 'button';
      go.textContent = `${pin.message.user.username}: ${pin.message.type === 'TEXT' ? pin.message.message.slice(0, 110) : pin.message.type === 'AUDIO' ? 'Áudio' : 'Figurinha'}`;
      go.addEventListener('click', () => navigateTo(pin.messageId));
      row.append(go);
      const meta = document.createElement('small'); meta.textContent = `Fixada por ${pin.pinnedBy.username} · ${new Date(pin.pinnedAt).toLocaleString('pt-BR')}`;
      row.append(meta);
      if (state.currentUser?.isSiteAdmin || ['OWNER', 'CO_ADMIN'].includes(state.roomRole)) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Desafixar';
        remove.addEventListener('click', async () => { try { await api(`/rooms/${state.roomId}/pins/${pin.messageId}`, { method: 'DELETE' }); await loadPins(); }
          catch (error) { $('community-pin-status').textContent = error.message; } });
        row.append(remove);
      }
      $('community-pin-list').append(row);
    }
    $('community-pin-status').textContent = pins.length ? '' : 'Ainda não há mensagens fixadas.';
  } catch (error) { $('community-pin-status').textContent = error.message; }
}

function renderPoll(poll) {
  const card = document.createElement('article'); card.className = 'community-poll';
  const heading = document.createElement('h3'); heading.textContent = poll.question;
  const meta = document.createElement('p'); meta.textContent = `${poll.creator.username} · Encerra ${new Date(poll.closesAt).toLocaleString('pt-BR')}`;
  const form = document.createElement('form'); const expired = new Date(poll.closesAt) <= new Date();
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
  for (const option of poll.options) {
    const label = document.createElement('label'); label.className = 'poll-option';
    const input = document.createElement('input'); input.type = poll.allowMultiple ? 'checkbox' : 'radio'; input.name = 'vote';
    input.value = option.id; input.checked = poll.selectedOptionIds.includes(option.id);
    input.disabled = expired || (!poll.allowChange && poll.selectedOptionIds.length > 0);
    const name = document.createElement('span'); name.textContent = option.label;
    const tally = document.createElement('small'); tally.textContent = `${option.votes} · ${total ? Math.round(option.votes / total * 100) : 0}%`;
    label.append(input, name, tally); form.append(label);
  }
  const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Votar';
  button.disabled = expired || (!poll.allowChange && poll.selectedOptionIds.length > 0); form.append(button);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true;
    try { const ids = [...form.querySelectorAll('input:checked')].map(input => input.value);
      await api(`/polls/${encodeURIComponent(poll.id)}/vote`, { method: 'PUT', body: JSON.stringify({ optionIds: ids }) });
      await loadPolls(true); }
    catch (error) { status.textContent = error.message; button.disabled = false; }
  });
  card.append(heading, meta, form, status);
  if (state.currentUser?.id === poll.creator.id || state.currentUser?.isSiteAdmin || ['OWNER', 'CO_ADMIN'].includes(state.roomRole)) {
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'poll-delete'; remove.textContent = 'Excluir enquete';
    remove.addEventListener('click', async () => { if (!confirm('Excluir esta enquete?')) return;
      try { await api(`/polls/${poll.id}`, { method: 'DELETE' }); await loadPolls(true); }
      catch (error) { status.textContent = error.message; } }); card.append(remove);
  }
  return card;
}

async function loadPolls(reset = true) {
  if (!state.roomId) return;
  const seq = ++pollSeq;
  if (reset) { pollCursor = null; $('community-poll-list').replaceChildren(); }
  try {
    const params = new URLSearchParams(); if (pollCursor) params.set('cursor', pollCursor);
    const { polls, nextCursor } = await api(`/rooms/${state.roomId}/polls?${params}`);
    if (seq !== pollSeq) return;
    for (const poll of polls) $('community-poll-list').append(renderPoll(poll));
    pollCursor = nextCursor;
    $('community-poll-more').classList.toggle('hidden', !nextCursor);
    if (!$('community-poll-list').childElementCount) $('community-poll-list').textContent = 'Nenhuma enquete por aqui.';
  } catch (error) { $('community-poll-status').textContent = error.message; }
}

function renderSearchResult(message) {
  const row = document.createElement('button'); row.type = 'button'; row.className = 'community-result search-result';
  const preview = message.type === 'TEXT' ? message.message.slice(0, 160) : message.type === 'AUDIO' ? 'Áudio' : 'Figurinha';
  row.textContent = `${message.user.username} · ${new Date(message.createdAt).toLocaleString('pt-BR')} — ${preview}`;
  row.addEventListener('click', () => navigateTo(message.id)); return row;
}

async function loadSearch(reset = true) {
  if (!state.roomId) return;
  if (reset) { searchCursor = null; $('community-search-results').replaceChildren(); }
  const params = new URLSearchParams(searchParams);
  if (searchCursor) params.set('cursor', searchCursor);
  try {
    const { messages, nextCursor } = await api(`/rooms/${state.roomId}/search?${params}`);
    for (const message of messages) $('community-search-results').append(renderSearchResult(message));
    searchCursor = nextCursor;
    $('community-search-more').classList.toggle('hidden', !nextCursor);
    $('community-search-status').textContent = $('community-search-results').childElementCount ? '' : 'Nenhuma mensagem encontrada.';
  } catch (error) { $('community-search-status').textContent = error.message; }
}

function openTab(tab) {
  activeTab = activeTab === tab ? null : tab;
  $('community-tool-panel').classList.toggle('hidden', !activeTab);
  for (const name of ['pins', 'polls', 'search']) {
    $(`community-${name}`).classList.toggle('hidden', activeTab !== name);
    document.querySelectorAll(`[data-community-tab="${name}"]`).forEach(button => {
      button.setAttribute('aria-expanded', String(activeTab === name));
    });
  }
  if (activeTab === 'pins') void loadPins();
  if (activeTab === 'polls') void loadPolls(true);
}

export function initializeCommunity() {
  $('discover-interests-form').addEventListener('submit', async event => {
    event.preventDefault();
    const topics = [...$('discover-interests-options').querySelectorAll('input:checked')].map(input => input.value);
    try { await api('/interests', { method: 'PUT', body: JSON.stringify({ topics }) });
      $('discover-interests-status').textContent = 'Interesses salvos.';
      if ($('discover-sort').value === 'forYou') await loadDiscover(); }
    catch (error) { $('discover-interests-status').textContent = error.message; }
  });
  $('discover-form').addEventListener('submit', event => { event.preventDefault(); void loadDiscover(); });
  for (const id of ['discover-topic', 'discover-sort', 'discover-favorites']) $(id).addEventListener('change', () => loadDiscover());
  $('discover-more').addEventListener('click', () => loadDiscover(false));
  document.querySelectorAll('[data-community-tab]').forEach(button => button.addEventListener('click', () => openTab(button.dataset.communityTab)));
  $('community-poll-more').addEventListener('click', () => loadPolls(false));
  $('poll-create-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const options = $('poll-options').value.split('\n').map(value => value.trim()).filter(Boolean);
      await api(`/rooms/${state.roomId}/polls`, { method: 'POST', body: JSON.stringify({
        question: $('poll-question').value, options, closesAt: new Date($('poll-closes-at').value).toISOString(),
        allowMultiple: $('poll-multiple').checked, allowChange: $('poll-change').checked,
      }) });
      $('poll-create-form').reset(); $('community-poll-status').textContent = 'Enquete criada.'; await loadPolls(true);
    } catch (error) { $('community-poll-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('community-search-form').addEventListener('submit', event => {
    event.preventDefault(); searchParams = new URLSearchParams();
    if ($('community-search-query').value.trim()) searchParams.set('q', $('community-search-query').value.trim());
    if ($('community-search-author').value.trim()) searchParams.set('author', $('community-search-author').value.trim());
    if ($('community-search-type').value) searchParams.set('type', $('community-search-type').value);
    if ($('community-search-from').value) searchParams.set('from', new Date(`${$('community-search-from').value}T00:00:00`).toISOString());
    if ($('community-search-to').value) searchParams.set('to', new Date(`${$('community-search-to').value}T23:59:59.999`).toISOString());
    void loadSearch(true);
  });
  $('community-search-more').addEventListener('click', () => loadSearch(false));
  state.socket.on('room-pins-updated', payload => { if (payload.roomId === state.roomId && activeTab === 'pins') void loadPins(); });
  state.socket.on('room-polls-updated', payload => { if (payload.roomId === state.roomId && activeTab === 'polls') void loadPolls(true); });
  state.socket.on('chat-history', () => {
    if (activeTab === 'pins') void loadPins();
    if (activeTab === 'polls') void loadPolls(true);
    $('community-search-results').replaceChildren(); $('community-search-status').textContent = '';
  });
}
