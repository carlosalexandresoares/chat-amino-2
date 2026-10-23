const token = localStorage.getItem('authToken');
if (!token) location.replace('/login.html');
const $ = id => document.getElementById(id);
let overview = null;
let historyCursor = null;

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { localStorage.removeItem('authToken'); location.replace('/login.html'); throw new Error('Sessão expirada.'); }
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a ação.');
  return data;
}

function element(tag, text, className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}

function action(label, callback) {
  const button = element('button', label); button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await callback(); await loadOverview(); }
    catch (error) { $('game-status').textContent = error.message; button.disabled = false; }
  });
  return button;
}

function card(title, icon, description, subtitle) {
  const article = element('article', '', 'game-card');
  const heading = element('div', '', 'game-card-heading');
  heading.append(element('span', icon, 'game-card-icon'));
  const copy = document.createElement('div'); copy.append(element('h3', title), element('small', subtitle));
  heading.append(copy); article.append(heading, element('p', description)); return article;
}

function progress(article, current, target) {
  const bar = element('div', '', 'game-progress');
  const fill = document.createElement('span'); fill.style.width = `${Math.min(100, Math.round(current / target * 100))}%`;
  bar.append(fill); article.append(bar);
}

function renderMissions(missions) {
  const list = $('mission-list'); list.replaceChildren();
  for (const mission of missions) {
    const complete = mission.progress >= mission.target;
    const article = card(mission.title, mission.cadence === 'DAILY' ? '☀️' : '🗓️', mission.description,
      mission.cadence === 'DAILY' ? 'Diária' : 'Semanal');
    if (complete) article.classList.add('complete');
    progress(article, mission.progress, mission.target);
    const footer = element('div', '', 'game-card-footer');
    footer.append(element('strong', `${mission.progress}/${mission.target} · +${mission.coinReward} moedas`));
    if (mission.claimed) footer.append(element('span', 'Coletada', 'game-card-status'));
    else footer.append(action('Coletar', () => request(`/api/gamification/missions/${mission.id}/claim`, { method: 'POST' })));
    footer.querySelector('button')?.toggleAttribute('disabled', !complete);
    article.append(footer); list.append(article);
  }
}

function renderAchievements(achievements) {
  const list = $('achievement-list'); list.replaceChildren();
  for (const item of achievements) {
    const article = card(item.title, item.medal, item.description, item.unlockedAt ?
      `Desbloqueada em ${new Date(item.unlockedAt).toLocaleDateString('pt-BR')}` : 'Ainda bloqueada');
    article.classList.add(item.unlockedAt ? 'unlocked' : 'locked');
    progress(article, item.progress, item.target);
    const footer = element('div', '', 'game-card-footer');
    footer.append(element('strong', `${item.progress}/${item.target} · +${item.coinReward} moedas`));
    if (item.coinsClaimedAt) footer.append(element('span', 'Recompensa coletada', 'game-card-status'));
    else if (item.unlockedAt) footer.append(action('Coletar', () => request(`/api/gamification/achievements/${item.id}/claim`, { method: 'POST' })));
    article.append(footer); list.append(article);
  }
}

const typeLabels = { FRAME: 'Moldura de avatar', TITLE: 'Título especial', PROFILE_THEME: 'Tema de perfil' };
function renderShop(items) {
  const list = $('shop-list'); list.replaceChildren();
  for (const item of items) {
    const article = card(item.title, item.type === 'FRAME' ? '◉' : item.type === 'TITLE' ? '✦' : '✧',
      item.description, `${typeLabels[item.type]} · ${item.rarity}`);
    const footer = element('div', '', 'game-card-footer'); footer.append(element('strong', `${item.price} moedas`));
    if (item.owned) footer.append(element('span', 'Adquirido', 'game-card-status'));
    else footer.append(action('Comprar', () => request(`/api/gamification/items/${item.id}/purchase`, { method: 'POST' })));
    article.append(footer); list.append(article);
  }
}

function renderInventory(inventory) {
  const list = $('inventory-list'); list.replaceChildren();
  if (!inventory.length) { list.append(element('p', 'Você ainda não adquiriu cosméticos.')); return; }
  for (const entry of inventory) {
    if (!entry.item) continue;
    const item = entry.item;
    const article = card(item.title, item.type === 'FRAME' ? '◉' : item.type === 'TITLE' ? '✦' : '✧',
      item.description, typeLabels[item.type]);
    const footer = element('div', '', 'game-card-footer');
    footer.append(element('strong', entry.equipped ? 'Em uso' : 'No inventário'));
    footer.append(action(entry.equipped ? 'Remover' : 'Equipar', () => request(`/api/gamification/items/${item.id}/equip`,
      { method: entry.equipped ? 'DELETE' : 'PUT' })));
    article.append(footer); list.append(article);
  }
}

function appendHistory(transactions, reset = false) {
  const list = $('coin-history'); if (reset) list.replaceChildren();
  const reasonLabels = { MISSION: 'Missão coletada', ACHIEVEMENT: 'Conquista coletada', PURCHASE: 'Item adquirido' };
  for (const row of transactions) {
    const article = element('article', '', 'game-transaction');
    const label = document.createElement('div');
    label.append(element('span', reasonLabels[row.reason] || row.reason),
      element('small', new Date(row.createdAt).toLocaleString('pt-BR')));
    const amount = element('strong', `${row.amount > 0 ? '+' : ''}${row.amount}`);
    if (row.amount < 0) amount.classList.add('negative');
    amount.title = `Saldo após a operação: ${row.balanceAfter}`;
    article.append(label, amount); list.append(article);
  }
  if (!list.childElementCount) list.append(element('p', 'Nenhuma transação ainda.'));
  historyCursor = transactions.length === 20 ? transactions.at(-1).id : null;
  $('history-more').classList.toggle('hidden', !historyCursor);
}

async function loadOverview() {
  $('game-status').textContent = 'Atualizando sua jornada...';
  try {
    overview = await request('/api/gamification/overview');
    $('coin-balance').textContent = overview.balance.toLocaleString('pt-BR');
    renderMissions(overview.missions); renderAchievements(overview.achievements);
    renderShop(overview.catalog); renderInventory(overview.inventory);
    appendHistory(overview.transactions, true);
    $('game-status').textContent = '';
  } catch (error) { $('game-status').textContent = error.message; }
}

$('history-more').addEventListener('click', async () => {
  if (!historyCursor) return;
  const button = $('history-more'); button.disabled = true;
  try {
    const data = await request(`/api/gamification/ledger?cursor=${encodeURIComponent(historyCursor)}`);
    appendHistory(data.transactions); historyCursor = data.nextCursor;
    button.classList.toggle('hidden', !historyCursor);
  } catch (error) { $('game-status').textContent = error.message; }
  finally { button.disabled = false; }
});
if (token) {
  if (typeof io === 'function') window.ChatNotificationBadge?.attachSocket(io({ auth: { token } }));
  void loadOverview();
}
