const token = localStorage.getItem("authToken");
if (!token) window.location.href = "/login.html";
if (token && typeof io === 'function') {
  const profileSocket = io({ auth: { token } });
  window.ChatNotificationBadge?.attachSocket(profileSocket);
  profileSocket.on('level-up', (data) => {
    const toast = document.getElementById('level-toast');
    toast.textContent = `Parabéns! Você alcançou o nível ${data.level} — ${data.title}!`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 5000);
    loadProfile();
  });
  profileSocket.on('account-deleted', payload => {
    localStorage.removeItem('authToken');
    alert(payload?.message || 'Sua conta foi excluída.');
    window.location.replace('/login.html');
  });
}

const $ = (id) => document.getElementById(id);
const targetId = new URLSearchParams(window.location.search).get("id");
const followButton = $("follow-button");
const postForm = $("new-post-form");
const postList = $("profile-post-list");
const message = $("profile-message");
const connectionsDialog = $("connections-dialog");
const connectionsList = $("connections-list");
const connectionsMessage = $("connections-message");
const loadMoreConnections = $("load-more-connections");
let viewedUser = null;
let currentUserIsSiteAdmin = false;
let connectionsKind = "followers";
let connectionsOffset = 0;
let connectionsRequestId = 0;
let rankingPage = 1;
const fmt = new Intl.NumberFormat('pt-BR');

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("O servidor ainda não carregou esta função. Reinicie-o e atualize a página.");
  }
  const data = await response.json();
  if (response.status === 401) {
    localStorage.removeItem('authToken');
    location.replace('/login.html');
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (!response.ok) throw new Error(data.message || "Não foi possível completar a ação.");
  return data;
}

function updateAvatar(user) {
  const avatar = $("profile-avatar");
  avatar.replaceChildren();
  if (user.avatar) {
    const image = document.createElement("img");
    image.src = user.avatar;
    image.alt = `Avatar de ${user.username}`;
    image.onerror = () => { avatar.textContent = user.username[0].toUpperCase(); };
    avatar.append(image);
  } else avatar.textContent = user.username[0].toUpperCase();
}

function renderProfile(user) {
  viewedUser = user;
  $("profile-load-message").classList.add("hidden");
  document.title = `${user.username} | Purpverse`;
  $("profile-username").textContent = user.username;
  $("profile-level").textContent = `LV ${user.level}`;
  $("profile-title").textContent = user.title;
  $('profile-presence').textContent = user.statusText || ({ ONLINE: 'Online', AWAY: 'Ausente', BUSY: 'Ocupado', INVISIBLE: 'Invisível' }[user.presenceStatus] || '');
  $("profile-xp").textContent = user.nextLevelXp === null ? `${fmt.format(user.xp)} XP` : `${fmt.format(user.xp)} / ${fmt.format(user.nextLevelXp)} XP`;
  $("profile-next-xp").textContent = user.nextLevelXp === null ? 'Nível Máximo' : `Faltam ${fmt.format(user.xpToNext)} XP para o próximo nível.`;
  $("profile-rank").textContent = `Posição geral: #${fmt.format(user.rank)}`;
  $("checkin-status").textContent = `Sequência: ${user.checkin.streak} dia(s). ${user.checkin.claimed ? 'Check-in de hoje concluído.' : `Próximo check-in: ${Math.min(user.checkin.streak + 1, 11)} XP.`}`;
  $("checkin-button").classList.toggle('hidden', !user.isSelf || user.checkin.claimed);
  $("profile-bio").textContent = user.bio || "Este usuário ainda não adicionou uma biografia.";
  $("profile-followers-count").textContent = user.followersCount;
  $("profile-following-count").textContent = user.followingCount;
  $("profile-posts-count").textContent = user.postsCount;
  $("xp-progress").style.width = `${user.progressPercent}%`;
  $("profile-banner").style.backgroundImage = user.banner
    ? `url("${user.banner.replaceAll('"', '%22')}")` : "";
  updateAvatar(user);
  $("profile-email").classList.add("hidden");
  $("edit-profile-button").classList.toggle("hidden", !user.isSelf);
  postForm.classList.toggle("hidden", !user.isSelf);
  followButton.classList.toggle("hidden", user.isSelf);
  $('direct-message-link').classList.toggle('hidden', user.isSelf || user.isBlockedByMe);
  $('direct-message-link').href = `/direct.html?user=${encodeURIComponent(user.id)}`;
  $('profile-block-button').classList.toggle('hidden', user.isSelf);
  $('profile-report-button').classList.toggle('hidden', user.isSelf);
  $('profile-privacy').classList.toggle('hidden', !user.isSelf);
  $('profile-delete-open').classList.toggle('hidden', !user.isSelf || currentUserIsSiteAdmin);
  $('profile-admin-delete-note').classList.toggle('hidden', !user.isSelf || !currentUserIsSiteAdmin);
  if (user.isSelf) $('profile-visibility').value = user.profileVisibility || 'PUBLIC';
  $('profile-block-button').textContent = user.isBlockedByMe ? 'Desbloquear' : 'Bloquear';
  $("logout-button").classList.toggle("hidden", !user.isSelf);
  followButton.textContent = user.isFollowing ? "Seguindo" : "Seguir";
  followButton.classList.toggle("following", user.isFollowing);
}
async function loadShowcase(userId) {
  try {
    const data = await request(`/api/gamification/users/${encodeURIComponent(userId)}/showcase`);
    if (viewedUser?.id !== userId) return;
    const medals = $('profile-medal-list'); medals.replaceChildren();
    for (const entry of data.achievements) {
      const badge = document.createElement('span'); badge.textContent = entry.achievement.medal;
      badge.title = entry.achievement.title; badge.setAttribute('aria-label', entry.achievement.title);
      medals.append(badge);
    }
    if (!data.achievements.length) medals.textContent = 'Nenhuma medalha ainda';
    const frame = data.equipped.find(item => item.type === 'FRAME');
    const theme = data.equipped.find(item => item.type === 'PROFILE_THEME');
    const title = data.equipped.find(item => item.type === 'TITLE');
    $('profile-avatar').classList.remove('frame-amethyst', 'frame-ember');
    if (frame && ['amethyst', 'ember'].includes(frame.cssToken)) $('profile-avatar').classList.add(`frame-${frame.cssToken}`);
    document.querySelector('.profile-card').classList.remove('theme-aurora', 'theme-night');
    if (theme && ['aurora', 'night'].includes(theme.cssToken)) document.querySelector('.profile-card').classList.add(`theme-${theme.cssToken}`);
    $('profile-special-title').textContent = title?.title || '';
    $('profile-special-title').classList.toggle('hidden', !title);
  } catch (error) { console.error('Falha ao carregar medalhas:', error); }
}
$('profile-block-button').addEventListener('click', async () => {
  if (!viewedUser || viewedUser.isSelf) return;
  try {
    await request(`/api/direct/blocks/${encodeURIComponent(viewedUser.id)}`, {
      method: viewedUser.isBlockedByMe ? 'DELETE' : 'PUT',
    });
    loadProfile();
  } catch (error) { message.textContent = error.message; }
});
$('profile-report-button').addEventListener('click', () => $('profile-report-dialog').showModal());
$('profile-report-send').addEventListener('click', async () => {
  const button = $('profile-report-send'); button.disabled = true;
  try {
    await request('/api/moderation/reports', { method: 'POST', body: JSON.stringify({
      kind: 'USER', targetId: viewedUser.id, reason: $('profile-report-reason').value,
      details: $('profile-report-details').value }) });
    $('profile-report-dialog').close(); message.textContent = 'Denúncia enviada.';
  } catch (error) { $('profile-report-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('profile-visibility-save').addEventListener('click', async () => {
  const button = $('profile-visibility-save'); button.disabled = true;
  try {
    const result = await request('/api/auth/privacy', { method: 'PATCH', body: JSON.stringify({
      profileVisibility: $('profile-visibility').value }) });
    viewedUser.profileVisibility = result.profileVisibility;
    $('profile-privacy-status').textContent = 'Privacidade atualizada.';
  } catch (error) { $('profile-privacy-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('profile-delete-open').addEventListener('click', () => $('profile-delete-dialog').showModal());
$('profile-delete-confirm').addEventListener('click', async () => {
  const button = $('profile-delete-confirm'); button.disabled = true;
  try {
    await request('/api/auth/account', { method: 'DELETE', body: JSON.stringify({
      password: $('profile-delete-password').value }) });
    localStorage.removeItem('authToken'); location.replace('/login.html');
  } catch (error) { $('profile-delete-status').textContent = error.message; button.disabled = false; }
});

function renderPosts(posts) {
  postList.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "posts-empty";
    empty.textContent = "Ainda não há posts.";
    postList.append(empty);
  }
  for (const post of posts) {
    const article = document.createElement("article");
    article.className = "profile-post";
    article.id = `post-${post.id}`;
    const date = document.createElement("time");
    date.dateTime = post.createdAt;
    date.textContent = new Date(post.createdAt).toLocaleDateString("pt-BR");
    const content = document.createElement("p");
    content.textContent = post.content || (post.sharedPost ? `Compartilhou uma publicação de ${post.sharedPost.user.username}` : '');
    article.append(date, content);
    if (post.sharedPost) {
      const original = document.createElement('a'); original.href = `/feed.html?post=${encodeURIComponent(post.sharedPost.id)}`;
      original.textContent = `${post.sharedPost.user.username}: ${post.sharedPost.content.slice(0, 180)}`;
      article.append(original);
    }
    const discussion = document.createElement('a'); discussion.href = `/feed.html?post=${encodeURIComponent(post.id)}`;
    discussion.className = 'profile-post-discussion'; discussion.textContent = `Ver post e comentários (${post._count?.comments || 0})`;
    article.append(discussion);
    if (post.featuredAt) { const mark = document.createElement('strong'); mark.textContent = '★ Destaque'; article.append(mark); }
    if (viewedUser?.id !== currentUserId) {
      const like = document.createElement('button');
      like.type = 'button'; like.className = 'follow-button';
      like.textContent = `Curtir (${post._count?.likes || 0})`;
      like.disabled = Boolean(post.likes?.length);
      like.addEventListener('click', async () => { try { await request(`/api/posts/${post.id}/like`, { method: 'POST' }); loadPosts(); } catch (e) { message.textContent = e.message; } });
      article.append(like);
    }
    if (!post.featuredAt && (currentUserIsSiteAdmin ||
      (post.roomId && viewedUser?.viewerModeratedRoomIds?.includes(post.roomId)))) {
      const feature = document.createElement('button'); feature.type = 'button'; feature.className = 'follow-button'; feature.textContent = 'Destacar';
      feature.addEventListener('click', async () => { try { await request(`/api/posts/${post.id}/feature`, { method: 'POST' }); loadPosts(); } catch (e) { message.textContent = e.message; } });
      article.append(feature);
    }
    if (currentUserIsSiteAdmin) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'follow-button'; remove.textContent = 'Excluir publicação';
      remove.addEventListener('click', async () => {
        if (!confirm('Excluir esta publicação permanentemente?')) return;
        try { await request(`/api/posts/${post.id}`, { method: 'DELETE' }); loadPosts(); }
        catch (error) { message.textContent = error.message; }
      });
      article.append(remove);
    }
    postList.append(article);
  }
  if (location.hash.startsWith('#post-')) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' }));
}

function connectionRow(user) {
  const link = document.createElement("a");
  link.className = "connection-row";
  link.href = `/perfil.html?id=${encodeURIComponent(user.id)}`;
  const avatar = document.createElement("span");
  avatar.className = "connection-avatar";
  if (user.avatar) {
    const image = document.createElement("img");
    image.src = user.avatar;
    image.alt = "";
    image.onerror = () => { avatar.textContent = user.username[0].toUpperCase(); };
    avatar.append(image);
  } else avatar.textContent = user.username[0].toUpperCase();
  const details = document.createElement("span");
  details.className = "connection-details";
  const name = document.createElement("strong");
  name.textContent = user.username;
  const bio = document.createElement("small");
  bio.textContent = user.bio || "Ver perfil";
  details.append(name, bio);
  const arrow = document.createElement("span");
  arrow.className = "connection-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↗";
  link.append(avatar, details, arrow);
  return link;
}

async function loadConnections(reset = false) {
  if (!viewedUser) return;
  const requestId = ++connectionsRequestId;
  if (reset) {
    connectionsOffset = 0;
    connectionsList.replaceChildren();
  }
  connectionsMessage.textContent = "Carregando pessoas...";
  loadMoreConnections.classList.add("hidden");
  try {
    const data = await request(`/api/users/${encodeURIComponent(viewedUser.id)}/${connectionsKind}?offset=${connectionsOffset}`);
    if (requestId !== connectionsRequestId) return;
    for (const user of data.users) connectionsList.append(connectionRow(user));
    connectionsOffset = data.nextOffset;
    connectionsMessage.textContent = connectionsList.childElementCount ? "" :
      connectionsKind === "followers" ? "Ainda não há seguidores." : "Ainda não segue ninguém.";
    loadMoreConnections.classList.toggle("hidden", !data.hasMore);
  } catch (error) {
    if (requestId === connectionsRequestId) connectionsMessage.textContent = error.message;
  }
}

function openConnections(kind) {
  if (!viewedUser) return;
  connectionsKind = kind;
  $("connections-title").textContent = kind === "followers" ? "Seguidores" : "Seguindo";
  connectionsDialog.showModal();
  loadConnections(true);
}

$("profile-followers-button").addEventListener("click", () => openConnections("followers"));
$("profile-following-button").addEventListener("click", () => openConnections("following"));
$("close-connections").addEventListener("click", () => connectionsDialog.close());
connectionsDialog.addEventListener("click", (event) => {
  if (event.target === connectionsDialog) connectionsDialog.close();
});
connectionsDialog.addEventListener("close", () => { connectionsRequestId += 1; });
loadMoreConnections.addEventListener("click", () => loadConnections());

async function loadProfile() {
  try {
    const me = await request("/api/auth/me");
    currentUserIsSiteAdmin = Boolean(me.user.isSiteAdmin);
    $('site-admin-link').classList.toggle('hidden', !currentUserIsSiteAdmin);
    const id = targetId || me.user.id;
    currentUserId = me.user.id;
    const profile = await request(`/api/users/${encodeURIComponent(id)}`);
    renderProfile(profile.user);
    void loadShowcase(id);
    try {
      const posts = await request(`/api/users/${encodeURIComponent(id)}/posts`);
      renderPosts(posts.posts);
    } catch (postsError) { message.textContent = postsError.message; }
    loadRanking(true);
  } catch (error) {
    $("profile-username").textContent = "Não foi possível carregar o perfil";
    $("profile-load-message").textContent = error.message;
    $("profile-load-message").classList.remove("hidden");
  }
}
let currentUserId = null;
async function loadPosts() {
  if (!viewedUser) return;
  const data = await request(`/api/users/${encodeURIComponent(viewedUser.id)}/posts`);
  renderPosts(data.posts);
  const profile = await request(`/api/users/${encodeURIComponent(viewedUser.id)}`);
  renderProfile(profile.user);
}
async function loadRanking(reset = false) {
  if (reset) { rankingPage = 1; $('ranking-list').replaceChildren(); }
  try {
    const data = await request(`/api/reputation/ranking?period=${$('ranking-period').value}&page=${rankingPage}`);
    for (const user of data.users) {
      const li = document.createElement('li');
      const link = document.createElement('a'); link.className = 'ranking-user'; link.href = `/perfil.html?id=${encodeURIComponent(user.id)}`;
      if (user.avatar) { const img = document.createElement('img'); img.src = user.avatar; img.alt = ''; link.append(img); }
      const label = document.createElement('span'); label.textContent = `#${user.position} ${user.username} · Nível ${user.level} — ${user.title} · ${fmt.format(user.points)} XP`; link.append(label); li.append(link); $('ranking-list').append(li);
    }
    $('ranking-more').classList.toggle('hidden', !data.hasMore);
    rankingPage += 1;
  } catch (e) { message.textContent = e.message; }
}
$('ranking-period').addEventListener('change', () => loadRanking(true));
$('ranking-more').addEventListener('click', () => loadRanking());
$('checkin-button').addEventListener('click', async () => {
  $('checkin-button').disabled = true;
  try { await request('/api/reputation/checkin', { method: 'POST' }); await loadProfile(); }
  catch (e) { message.textContent = e.message; }
  finally { $('checkin-button').disabled = false; }
});

followButton.addEventListener("click", async () => {
  if (!viewedUser) return;
  followButton.disabled = true;
  message.textContent = "";
  try {
    await request(`/api/users/${encodeURIComponent(viewedUser.id)}/follow`, {
      method: viewedUser.isFollowing ? "DELETE" : "POST",
    });
    viewedUser.isFollowing = !viewedUser.isFollowing;
    viewedUser.followersCount += viewedUser.isFollowing ? 1 : -1;
    renderProfile(viewedUser);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    followButton.disabled = false;
  }
});

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = $("new-post-content").value.trim();
  if (!content) return;
  const button = postForm.querySelector("button");
  button.disabled = true;
  message.textContent = "";
  try {
    await request("/api/posts", { method: "POST", body: JSON.stringify({ content }) });
    postForm.reset();
    const posts = await request(`/api/users/${encodeURIComponent(viewedUser.id)}/posts`);
    renderPosts(posts.posts);
    viewedUser.postsCount += 1;
    $("profile-posts-count").textContent = viewedUser.postsCount;
    await loadPosts();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("logout-button").addEventListener("click", () => {
  localStorage.removeItem("authToken");
  window.location.href = "/login.html";
});

loadProfile();
