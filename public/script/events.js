const token = localStorage.getItem('authToken');
if (!token) location.replace('/login.html');
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const roomParam = params.get('roomId') || '';
const eventParam = params.get('eventId') || '';
const typeNames = { PROJECTION: 'Projeção', ANIME: 'Sessão de anime',
  TOURNAMENT: 'Campeonato', QUIZ: 'Quiz', MEETUP: 'Encontro', CUSTOM: 'Personalizado' };
let rooms = [];
let me = null;
let page = 1;
let hasMore = false;
let loading = false;
let openedEventId = null;
const socket = typeof io === 'function' ? io({ auth: { token } }) : null;

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { localStorage.removeItem('authToken'); location.replace('/login.html'); }
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a ação.');
  return data;
}
const node = (tag, text, className = '') => {
  const item = document.createElement(tag); item.textContent = text; item.className = className; return item;
};
const setStatus = text => { $('events-status').textContent = text || ''; };
const when = event => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short',
  timeZone: event.timeZone }).format(new Date(event.startsAt));
function action(label, callback, className = '') {
  const button = node('button', label, className); button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await callback(); setStatus(''); await loadEvents(true);
      if (openedEventId) await openEvent(openedEventId); }
    catch (error) { setStatus(error.message); button.disabled = false; }
  });
  return button;
}
function zonedIso(value, zone) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw new Error('Informe data e horário.');
  const [year, month, day, hour, minute] = value.match(/\d+/g).map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = time => Object.fromEntries(formatter.formatToParts(new Date(time))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  let instant = desired;
  for (let i = 0; i < 3; i++) {
    const actual = parts(instant);
    const wall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    instant += desired - wall;
  }
  const actual = parts(instant);
  if (Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute) !== desired)
    throw new Error('Este horário não existe no fuso escolhido. Selecione outro horário.');
  return new Date(instant).toISOString();
}
function renderCard(event) {
  const card = node('article', '', 'event-card');
  if (event.coverUrl) { const cover = node('div', '', 'event-cover');
    cover.style.backgroundImage = `url("${event.coverUrl.replaceAll('"', '%22')}")`; card.append(cover); }
  const content = node('div', '', 'event-card-content');
  content.append(node('small', `${typeNames[event.type]} · ${event.room.name}`),
    node('h2', event.title), node('time', when(event)),
    node('p', event.description || 'Encontro da comunidade.'));
  if (new Date(event.startsAt) <= new Date()) content.append(node('strong', 'Acontecendo agora', 'event-live'));
  const foot = node('div', '', 'event-card-foot');
  foot.append(node('span', `${event.participantCount}${event.capacity ? `/${event.capacity}` : ''} confirmado(s)`));
  if (event.registered) foot.append(node('strong', event.attendedAt ? 'Presença marcada' : 'Você vai'));
  const view = node('button', 'Ver evento'); view.type = 'button';
  view.addEventListener('click', () => openEvent(event.id).catch(error => setStatus(error.message)));
  foot.append(view);
  content.append(foot); card.append(content); return card;
}
async function loadEvents(reset = false) {
  if (loading) return;
  loading = true;
  if (reset) { page = 1; $('events-list').replaceChildren(); }
  $('events-more').disabled = true;
  try {
    const query = new URLSearchParams({ page: String(page) });
    if ($('events-room').value) query.set('roomId', $('events-room').value);
    const result = await request(`/api/events?${query}`);
    for (const event of result.events) $('events-list').append(renderCard(event));
    hasMore = result.hasMore; page++;
    $('events-more').classList.toggle('hidden', !hasMore);
    if (!$('events-list').childElementCount) $('events-list').append(
      node('p', 'Nenhum evento marcado nas comunidades selecionadas.', 'events-empty'));
  } catch (error) { setStatus(error.message); }
  finally { loading = false; $('events-more').disabled = false; }
}
function field(labelText, input) {
  const label = document.createElement('label'); label.append(node('span', labelText), input); return label;
}
function dateInput(event) {
  const input = document.createElement('input'); input.type = 'datetime-local'; input.required = true;
  const date = new Date(event.startsAt);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: event.timeZone, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).filter(part => part.type !== 'literal');
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  input.value = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  return input;
}
async function openEvent(id) {
  const [{ event }, members] = await Promise.all([
    request(`/api/events/${encodeURIComponent(id)}`),
    request(`/api/events/${encodeURIComponent(id)}/participants`),
  ]);
  openedEventId = id;
  const content = $('event-dialog-content'); content.replaceChildren();
  $('event-dialog-title').textContent = event.title;
  const kind = node('p', `${typeNames[event.type]} · ${event.room.name}`, 'event-kind');
  content.append(kind, node('p', when(event) + ` · ${event.timeZone}`),
    node('p', `Organização: ${event.organizer.username}`));
  if (event.coverUrl) { const img = document.createElement('img'); img.src = event.coverUrl;
    img.alt = 'Capa do evento'; img.className = 'event-dialog-cover'; content.append(img); }
  if (event.description) content.append(node('p', event.description, 'event-description'));
  content.append(node('p', `${event.participantCount}${event.capacity ? ` de ${event.capacity}` : ''} participante(s) confirmado(s).`));
  if (event.status === 'CANCELLED') content.append(node('strong', 'Evento cancelado.'));
  else {
    const controls = node('div', '', 'event-actions');
    if (event.registered) {
      if (event.attendedAt) controls.append(node('strong', 'Presença registrada.'));
      else controls.append(action('Cancelar inscrição', async () =>
        request(`/api/events/${id}/register`, { method: 'DELETE' })));
      if (!event.attendedAt && new Date(event.startsAt) <= new Date() &&
          Date.now() <= new Date(event.startsAt).getTime() + 2 * 3600000) {
        controls.append(action('Marcar presença', async () =>
          request(`/api/events/${id}/checkin`, { method: 'POST' })));
      }
      controls.append(action(event.reminderEnabled ? 'Desativar lembrete' : 'Ativar lembrete',
        async () => request(`/api/events/${id}/reminder`, { method: 'PUT',
          body: JSON.stringify({ enabled: !event.reminderEnabled }) })));
    } else if (event.registrationOpen && new Date(event.startsAt) > new Date()) {
      const full = event.capacity !== null && event.participantCount >= event.capacity;
      const join = action(full ? 'Evento lotado' : 'Confirmar presença', async () =>
        request(`/api/events/${id}/register`, { method: 'POST' }));
      join.disabled = full; controls.append(join);
    }
    if (event.type === 'PROJECTION') {
      const link = node('a', 'Abrir projeções da comunidade', 'event-projection-link');
      link.href = `/index.html?sala=${encodeURIComponent(event.roomId)}#projections`;
      controls.append(link);
    }
    content.append(controls);
    if (me?.id === event.organizerId || rooms.find(room => room.id === event.roomId)?.canManage) {
      const manage = node('form', '', 'event-reschedule');
      const canReschedule = new Date(event.startsAt) > new Date();
      manage.append(node('h3', canReschedule ? 'Reagendar' : 'Gerenciar evento'));
      const date = dateInput(event);
      const zone = document.createElement('select');
      fillTimeZones(zone); zone.value = event.timeZone;
      if (canReschedule) manage.append(field('Nova data e horário', date), field('Fuso', zone));
      const save = node('button', 'Salvar nova data'); save.type = 'submit'; manage.append(save);
      save.classList.toggle('hidden', !canReschedule);
      manage.addEventListener('submit', async e => {
        e.preventDefault(); save.disabled = true;
        try { await request(`/api/events/${id}/reschedule`, { method: 'PUT',
          body: JSON.stringify({ startsAt: zonedIso(date.value, zone.value), timeZone: zone.value }) });
          await loadEvents(true); await openEvent(id); setStatus('Evento reagendado.'); }
        catch (error) { setStatus(error.message); save.disabled = false; }
      });
      manage.append(action('Cancelar evento', async () => {
        if (!confirm('Cancelar este evento para todos os inscritos?')) return;
        await request(`/api/events/${id}/cancel`, { method: 'POST' });
      }, 'event-danger'));
      content.append(manage);
    }
  }
  const participants = node('section', '', 'event-participants');
  participants.append(node('h3', 'Participantes confirmados'));
  if (!members.participants.length) participants.append(node('p', 'Ninguém se inscreveu ainda.'));
  const participantList = node('div', '', 'event-participant-list'); participants.append(participantList);
  const appendParticipants = rows => {
    for (const member of rows) {
      const link = node('a', member.user.username); link.href = `/perfil.html?id=${encodeURIComponent(member.user.id)}`;
      participantList.append(link);
    }
  };
  appendParticipants(members.participants);
  if (members.hasMore) {
    let nextPage = 2;
    const more = node('button', 'Carregar mais participantes'); more.type = 'button';
    more.addEventListener('click', async () => {
      more.disabled = true;
      try { const result = await request(`/api/events/${id}/participants?page=${nextPage++}`);
        appendParticipants(result.participants); more.classList.toggle('hidden', !result.hasMore); }
      catch (error) { setStatus(error.message); } finally { more.disabled = false; }
    });
    participants.append(more);
  }
  content.append(participants);
  if (!$('event-dialog').open) $('event-dialog').showModal();
}
function fillTimeZones(select) {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  const zones = [...new Set([local, 'America/Sao_Paulo', 'America/Manaus',
    'America/New_York', 'America/Los_Angeles', 'Europe/Lisbon', 'Europe/London', 'UTC'])];
  select.replaceChildren(...zones.map(zone => new Option(zone.replaceAll('_', ' '), zone)));
  select.value = local;
}
async function loadOrganizers() {
  const roomId = $('event-room').value;
  if (!roomId) return;
  const { members } = await request(`/api/rooms/${encodeURIComponent(roomId)}/members`);
  const selected = $('event-organizer').value;
  $('event-organizer').replaceChildren(...members.map(member =>
    new Option(member.user.username, member.user.id)));
  $('event-organizer').value = members.some(member => member.user.id === selected) ? selected : me.id;
}
async function init() {
  try {
    const [mine, identity] = await Promise.all([
      request('/api/events/rooms/mine'), request('/api/auth/me'),
    ]);
    rooms = mine.rooms; me = identity.user;
    for (const room of rooms) {
      $('events-room').add(new Option(room.name, room.id));
      if (room.canManage) $('event-room').add(new Option(room.name, room.id));
    }
    if (roomParam && rooms.some(room => room.id === roomParam)) $('events-room').value = roomParam;
    if (roomParam && rooms.some(room => room.id === roomParam && room.canManage)) $('event-room').value = roomParam;
    $('events-create-toggle').classList.toggle('hidden', !$('event-room').options.length);
    if ($('event-room').options.length) await loadOrganizers();
    fillTimeZones($('event-timezone'));
    await loadEvents(true);
    if (eventParam) await openEvent(eventParam);
  } catch (error) { setStatus(error.message); }
}
$('events-room').addEventListener('change', () => loadEvents(true));
$('events-more').addEventListener('click', () => loadEvents());
$('events-create-toggle').addEventListener('click', () => $('events-create-form').classList.toggle('hidden'));
$('event-room').addEventListener('change', () => loadOrganizers().catch(error => setStatus(error.message)));
$('events-create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    data.startsAt = zonedIso(data.startsAt, data.timeZone);
    data.capacity = data.capacity || null;
    const result = await request('/api/events', { method: 'POST', body: JSON.stringify(data) });
    form.reset(); fillTimeZones($('event-timezone')); await loadOrganizers(); form.classList.add('hidden');
    $('events-room').value = data.roomId; await loadEvents(true); await openEvent(result.eventId);
    setStatus('Evento publicado.');
  } catch (error) { setStatus(error.message); }
  finally { button.disabled = false; }
});
$('event-dialog-close').addEventListener('click', () => $('event-dialog').close());
$('event-dialog').addEventListener('close', () => { openedEventId = null; });
socket?.on('community-events-updated', async ({ roomId }) => {
  if (!$('events-room').value || $('events-room').value === roomId) await loadEvents(true);
});
void init();
