const $ = id => document.getElementById(id);
const token = localStorage.getItem('authToken');
if (!token) location.replace('/login.html');
const socket = io({ auth: { token } });
window.ChatNotificationBadge?.attachSocket(socket);
let category = '';
let cursor = null;
let loading = false;
let pendingRefresh = false;
let pushConfig = { available: false, publicKey: '' };
const labels = { SOCIAL: 'Social', CHAT: 'Chat', DIRECT: 'Mensagens privadas', PROJECTION: 'Projeções',
  EVENT: 'Eventos', ACHIEVEMENT: 'Conquistas', ADMIN: 'Avisos administrativos' };
const icons = { SOCIAL: '♥', CHAT: '＠', DIRECT: '✉', PROJECTION: '▶', EVENT: '◷', ACHIEVEMENT: '★', ADMIN: '!' };

async function request(path, options = {}) {
  const response = await fetch(`/api/notifications${path}`, { ...options, headers: {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  } });
  if (response.status === 401) { localStorage.removeItem('authToken'); location.replace('/login.html'); throw new Error('Sessão encerrada.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a ação.');
  return data;
}

function createRow(item) {
  const row = document.createElement('article'); row.className = 'notification-row';
  row.classList.toggle('unread', !item.readAt); row.dataset.id = item.id;
  const icon = document.createElement('span'); icon.className = 'notification-icon'; icon.textContent = icons[item.category] || '•';
  const copy = document.createElement('div'); copy.className = 'notification-copy';
  const link = document.createElement('a'); link.href = item.href;
  const title = document.createElement('strong'); title.textContent = item.title;
  const body = document.createElement('p'); body.textContent = item.body;
  const date = document.createElement('time'); date.dateTime = item.createdAt;
  date.textContent = new Date(item.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  link.append(title, body); link.addEventListener('click', async event => {
    event.preventDefault();
    try { await request(`/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' }); }
    catch { /* O conteúdo continua acessível mesmo se a leitura falhar. */ }
    location.href = link.href;
  });
  copy.append(link, date);
  const actions = document.createElement('div'); actions.className = 'row-actions';
  if (!item.readAt) {
    const read = document.createElement('button'); read.type = 'button'; read.textContent = 'Lida'; read.title = 'Marcar como lida';
    read.addEventListener('click', async () => { try { await request(`/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' });
      row.classList.remove('unread'); read.remove(); window.ChatNotificationBadge?.refresh(); }
    catch (error) { $('notification-status').textContent = error.message; } });
    actions.append(read);
  }
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Excluir';
  remove.addEventListener('click', async () => { try { await request(`/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    row.remove(); window.ChatNotificationBadge?.refresh(); }
  catch (error) { $('notification-status').textContent = error.message; } });
  actions.append(remove); row.append(icon, copy, actions);
  return row;
}

async function loadList(reset = false) {
  if (loading) { if (reset) pendingRefresh = true; return; }
  loading = true;
  if (reset) { cursor = null; $('notification-list').replaceChildren(); }
  $('notification-status').textContent = 'Carregando notificações...';
  try {
    const query = new URLSearchParams();
    if (category) query.set('category', category);
    if ($('unread-only').checked) query.set('unread', 'true');
    if (cursor) query.set('before', cursor);
    const data = await request(`/?${query}`);
    for (const item of data.notifications) $('notification-list').append(createRow(item));
    cursor = data.nextCursor;
    $('load-more-notifications').classList.toggle('hidden', !data.hasMore);
    $('notification-status').textContent = $('notification-list').childElementCount ? '' : 'Nenhuma notificação por aqui.';
  } catch (error) { $('notification-status').textContent = error.message; }
  finally {
    loading = false;
    if (pendingRefresh) { pendingRefresh = false; void loadList(true); }
  }
}

document.querySelectorAll('#notification-filters button').forEach(button => button.addEventListener('click', () => {
  category = button.dataset.category;
  document.querySelectorAll('#notification-filters button').forEach(item => {
    item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button));
  });
  loadList(true);
}));
$('unread-only').addEventListener('change', () => loadList(true));
$('load-more-notifications').addEventListener('click', () => loadList());
$('mark-all-read').addEventListener('click', async () => {
  try { await request('/read-all', { method: 'PATCH' }); await loadList(true); window.ChatNotificationBadge?.refresh(); }
  catch (error) { $('notification-status').textContent = error.message; }
});

async function loadPreferences() {
  try {
    const { preferences } = await request('/preferences/categories');
    $('notification-preferences').replaceChildren();
    for (const item of preferences) {
      const row = document.createElement('div'); row.className = 'preference-row';
      const name = document.createElement('span'); name.textContent = labels[item.category]; row.append(name);
      for (const [key, text] of [['enabled', 'Receber'], ['pushEnabled', 'Push']]) {
        const label = document.createElement('label'); const input = document.createElement('input');
        input.type = 'checkbox'; input.checked = item[key]; input.setAttribute('aria-label', `${text}: ${labels[item.category]}`);
        input.addEventListener('change', async () => { try { await request(`/preferences/categories/${item.category}`, {
          method: 'PATCH', body: JSON.stringify({ [key]: input.checked }),
        }); } catch (error) { input.checked = !input.checked; $('push-status').textContent = error.message; } });
        label.append(input, ` ${text}`); row.append(label);
      }
      $('notification-preferences').append(row);
    }
  } catch (error) { $('push-status').textContent = error.message; }
}

function applicationServerKey(base64) {
  const padded = base64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
async function registration() { return navigator.serviceWorker.register('/sw-notifications.js', { scope: '/' }); }
async function currentSubscription() { return (await registration()).pushManager.getSubscription(); }

async function loadDevices() {
  try {
    const { devices } = await request('/push/devices');
    $('push-devices').replaceChildren();
    for (const device of devices) {
      const row = document.createElement('div'); row.className = 'device-row';
      const label = document.createElement('span'); label.textContent = `${device.deviceLabel || 'Dispositivo'} · ${new Date(device.createdAt).toLocaleDateString('pt-BR')}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover';
      remove.setAttribute('aria-label', `Remover ${device.deviceLabel || 'dispositivo'}`);
      remove.addEventListener('click', async () => { try { await request(`/push/devices/${device.id}`, { method: 'DELETE' });
        const current = 'serviceWorker' in navigator && 'PushManager' in window ? await currentSubscription() : null;
        if (current?.endpoint === device.endpoint) await current.unsubscribe();
        await updatePushControls(); await loadDevices(); }
      catch (error) { $('push-status').textContent = error.message; } });
      row.append(label, remove); $('push-devices').append(row);
    }
    if (!devices.length) $('push-devices').textContent = 'Nenhum dispositivo inscrito.';
  } catch (error) { $('push-status').textContent = error.message; }
}

async function updatePushControls() {
  const supported = isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  $('enable-push').classList.toggle('hidden', !supported || !pushConfig.available);
  $('disable-push').classList.add('hidden');
  if (!supported) { $('push-status').textContent = 'Web Push não está disponível neste navegador ou contexto.'; return; }
  if (!pushConfig.available) { $('push-status').textContent = 'Web Push não está configurado neste servidor.'; return; }
  const current = await currentSubscription();
  $('enable-push').classList.toggle('hidden', Boolean(current));
  $('disable-push').classList.toggle('hidden', !current);
}

$('enable-push').addEventListener('click', async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { $('push-status').textContent = 'Permissão não concedida.'; return; }
    const worker = await registration();
    const subscription = await worker.pushManager.subscribe({ userVisibleOnly: true,
      applicationServerKey: applicationServerKey(pushConfig.publicKey) });
    await request('/push/subscriptions', { method: 'PUT', body: JSON.stringify(subscription.toJSON()) });
    $('push-status').textContent = 'Dispositivo inscrito. Ative Push nas categorias desejadas.';
    await updatePushControls(); await loadDevices();
  } catch (error) { $('push-status').textContent = error.message; }
});
$('disable-push').addEventListener('click', async () => {
  try {
    const current = await currentSubscription();
    if (current) { await request('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: current.endpoint }) });
      await current.unsubscribe(); }
    $('push-status').textContent = 'Notificações desativadas neste dispositivo.';
    await updatePushControls(); await loadDevices();
  } catch (error) { $('push-status').textContent = error.message; }
});

let refreshTimer;
for (const event of ['notification', 'notification-read', 'notifications-read-all', 'notification-deleted'])
  socket.on(event, () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => loadList(true), 150); });
socket.on('connect', () => { loadList(true); window.ChatNotificationBadge?.refresh(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'notifications-updated') loadList(true);
});

await loadList(true);
await loadPreferences();
try { pushConfig = await request('/push/config'); await updatePushControls(); await loadDevices(); }
catch (error) { $('push-status').textContent = error.message; }
