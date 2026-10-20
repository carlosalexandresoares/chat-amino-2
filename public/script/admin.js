const token = localStorage.getItem('authToken');
const $ = id => document.getElementById(id);
let currentUserId = null;
let tab = 'rooms';
let page = 1;
let search = '';
let revision = 0;

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Não foi possível completar a ação.');
  return data;
}

function row(label, detail, href, onDelete, deletable = true) {
  const item = document.createElement('article'); item.className = 'admin-row';
  const info = document.createElement('div'); info.className = 'admin-row-info';
  const title = document.createElement('strong'); title.textContent = label;
  const description = document.createElement('small'); description.textContent = detail;
  info.append(title, description);
  const actions = document.createElement('div'); actions.className = 'admin-row-actions';
  const link = document.createElement('a'); link.href = href; link.textContent = 'Abrir'; actions.append(link);
  if (deletable) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'admin-delete';
    button.textContent = tab === 'rooms' ? 'Excluir chat' : 'Excluir perfil';
    button.addEventListener('click', async () => {
      const warning = tab === 'rooms' ? 'O chat, mensagens e projeções serão excluídos.' : 'As mensagens e publicações desse perfil serão excluídas. Seus chats serão transferidos para SICK.';
      if (prompt(`${warning}\n\nDigite exatamente ${label} para confirmar:`) !== label) return;
      button.disabled = true;
      $('admin-status').textContent = '';
      try { await onDelete(); await load(true); $('admin-status').textContent = `${label} excluído com sucesso.`; }
      catch (error) { $('admin-status').textContent = error.message; button.disabled = false; }
    });
    actions.append(button);
  }
  item.append(info, actions);
  return item;
}

async function load(reset = false) {
  if (reset) { revision += 1; page = 1; $('admin-list').replaceChildren(); }
  const currentRevision = revision;
  const currentTab = tab;
  const currentPage = page;
  $('admin-more').disabled = true;
  const query = new URLSearchParams({ page: String(currentPage), search });
  try {
    const data = await request(`/api/admin/${currentTab}?${query}`);
    if (currentRevision !== revision) return;
    $('admin-count').textContent = `${data.total} ${tab === 'rooms' ? 'chat(s)' : 'perfil(is)'} encontrado(s)`;
    if (!data.total) $('admin-list').textContent = 'Nenhum resultado encontrado.';
    for (const item of data[tab]) {
      if (tab === 'rooms') $('admin-list').append(row(item.name,
        `${item.id === 'geral' ? 'Sala principal' : `Criador: ${item.owner?.username || 'Sem criador'}`} · ${item.membersCount} membros · ${item.messagesCount} mensagens`,
        `/index.html?sala=${encodeURIComponent(item.id)}`,
        () => request(`/api/admin/rooms/${encodeURIComponent(item.id)}`, { method: 'DELETE' }), item.id !== 'geral'));
      else $('admin-list').append(row(item.username,
        `${item.email} · Nível ${item.level} · ${item.ownedRooms} chat(s) criado(s)${item.isSiteAdmin ? ' · Administrador geral' : ''}`,
        `/perfil.html?id=${encodeURIComponent(item.id)}`,
        () => request(`/api/admin/users/${encodeURIComponent(item.id)}`, { method: 'DELETE' }),
        item.id !== currentUserId && !item.isSiteAdmin));
    }
    $('admin-more').classList.toggle('hidden', !data.hasMore);
    page = currentPage + 1;
  } catch (error) { if (currentRevision === revision) $('admin-status').textContent = error.message; }
  finally { $('admin-more').disabled = false; }
}

if (!token) location.replace('/login.html');
else request('/api/auth/me').then(({ user }) => {
  if (!user.isSiteAdmin) throw new Error('Acesso restrito ao administrador geral.');
  currentUserId = user.id;
  $('admin-content').classList.remove('hidden');
  document.querySelectorAll('[data-admin-tab]').forEach(button => button.addEventListener('click', () => {
    tab = button.dataset.adminTab;
    page = 1; search = '';
    $('admin-search').value = '';
    $('admin-search').placeholder = tab === 'rooms' ? 'Buscar chat pelo nome' : 'Buscar perfil por nome ou e-mail';
    document.querySelectorAll('[data-admin-tab]').forEach(item => item.classList.toggle('active', item === button));
    $('admin-status').textContent = '';
    load(true);
  }));
  $('admin-search-form').addEventListener('submit', event => {
    event.preventDefault(); search = $('admin-search').value.trim(); $('admin-status').textContent = ''; load(true);
  });
  $('admin-more').addEventListener('click', () => load());
  load(true);
}).catch(error => { $('admin-status').textContent = error.message; });
