const token = localStorage.getItem('authToken');
if (!token) location.replace('/login.html');
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let me = null;
let mode = ['following', 'forYou', 'saved'].includes(params.get('mode')) ? params.get('mode') : 'forYou';
let cursor = null;
let sequence = 0;
let dialogPostId = null;

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { localStorage.removeItem('authToken'); location.replace('/login.html'); throw new Error('Sessão expirada.'); }
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a ação.');
  return data;
}

function button(label, onClick, className = '') {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
  element.className = className;
  element.addEventListener('click', async () => {
    element.disabled = true;
    try { await onClick(element); } catch (error) { $('feed-status').textContent = error.message; }
    finally { element.disabled = false; }
  });
  return element;
}

function avatar(user) {
  const node = document.createElement('span'); node.className = 'feed-avatar';
  if (user.avatar) { const img = document.createElement('img'); img.src = user.avatar; img.alt = '';
    img.onerror = () => { node.textContent = user.username[0].toUpperCase(); }; node.append(img); }
  else node.textContent = user.username[0].toUpperCase();
  return node;
}

async function openComments(post, section, countButton) {
  section.classList.toggle('hidden');
  if (section.classList.contains('hidden') || section.dataset.loaded) return;
  section.dataset.loaded = 'true';
  const list = document.createElement('div'); list.className = 'feed-comments-list';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const more = button('Mais comentários', () => load(false), 'feed-more'); more.classList.add('hidden');
  const form = document.createElement('form'); form.className = 'feed-comment-form';
  const replyLabel = document.createElement('small');
  const textarea = document.createElement('textarea'); textarea.maxLength = 1000; textarea.rows = 2;
  textarea.placeholder = 'Escreva um comentário...'; textarea.required = true;
  const send = document.createElement('button'); send.type = 'submit'; send.textContent = 'Comentar';
  form.append(replyLabel, textarea, send);
  let next = null; let parentId = null;
  async function load(reset = true) {
    if (reset) { next = null; list.replaceChildren(); }
    const query = next ? `?cursor=${encodeURIComponent(next)}` : '';
    const data = await request(`/api/social/posts/${post.id}/comments${query}`);
    for (const comment of data.comments) {
      const row = document.createElement('article'); row.className = `feed-comment${comment.parentId ? ' reply' : ''}`;
      row.id = `comment-${comment.id}`;
      const author = document.createElement('a'); author.href = `/perfil.html?id=${encodeURIComponent(comment.user.id)}`;
      author.textContent = comment.user.username;
      const time = document.createElement('small'); time.textContent = new Date(comment.createdAt).toLocaleString('pt-BR');
      const content = document.createElement('p'); content.textContent = comment.content;
      row.append(author, document.createTextNode(' · '), time);
      if (comment.parent) { const reply = document.createElement('small');
        reply.textContent = ` · em resposta a ${comment.parent.user.username}`; row.append(reply); }
      row.append(content);
      if (!comment.parentId) row.append(button('Responder', () => {
        parentId = comment.id; replyLabel.textContent = `Respondendo a ${comment.user.username} · `;
        const cancel = button('Cancelar', () => { parentId = null; replyLabel.replaceChildren(); });
        replyLabel.replaceChildren(`Respondendo a ${comment.user.username} · `, cancel); textarea.focus();
      }));
      if (comment.user.id === me.id || post.userId === me.id || me.isSiteAdmin)
        row.append(button('Excluir', async () => { if (!confirm('Excluir comentário?')) return;
          await request(`/api/social/comments/${comment.id}`, { method: 'DELETE' });
          await load(true); }, 'comment-delete'));
      list.append(row);
    }
    next = data.nextCursor; more.classList.toggle('hidden', !next);
    if (!list.childElementCount) list.textContent = 'Nenhum comentário ainda. Comece a conversa.';
    if (location.hash.startsWith('#comment-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); send.disabled = true;
    try { await request(`/api/social/posts/${post.id}/comments`, { method: 'POST',
      body: JSON.stringify({ content: textarea.value, parentId }) });
      textarea.value = ''; parentId = null; replyLabel.replaceChildren();
      post.commentsCount++; countButton.textContent = `💬 ${post.commentsCount}`;
      await load(true); status.textContent = 'Comentário publicado.';
    } catch (error) { status.textContent = error.message; } finally { send.disabled = false; }
  });
  section.append(list, more, form, status);
  try { await load(); } catch (error) { status.textContent = error.message; }
}

function renderPost(post) {
  const card = document.createElement('article'); card.className = 'feed-card'; card.id = `post-${post.id}`;
  const header = document.createElement('div'); header.className = 'feed-card-header'; header.append(avatar(post.user));
  const heading = document.createElement('div'); heading.className = 'feed-card-heading';
  const name = document.createElement('a'); name.href = `/perfil.html?id=${encodeURIComponent(post.user.id)}`;
  name.textContent = `${post.user.username} · LV ${post.user.level}`; heading.append(name);
  if (post.room) { const room = document.createElement('a'); room.href = `/index.html?sala=${encodeURIComponent(post.room.id)}`;
    room.textContent = `em ${post.room.name}`; heading.append(room); }
  const time = document.createElement('time'); time.dateTime = post.createdAt;
  time.textContent = new Date(post.createdAt).toLocaleString('pt-BR'); heading.append(time); header.append(heading);
  if (post.featuredAt) { const star = document.createElement('span'); star.className = 'feed-featured';
    star.textContent = '★ Destaque'; header.append(star); }
  card.append(header);
  if (post.content) { const content = document.createElement('p'); content.className = 'feed-content';
    content.textContent = post.content; card.append(content); }
  if (post.sharedPost) { const shared = document.createElement('a'); shared.className = 'feed-shared';
    shared.href = `/feed.html?post=${encodeURIComponent(post.sharedPost.id)}`;
    const label = document.createElement('small'); label.textContent = `Compartilhado de ${post.sharedPost.user.username}`;
    const content = document.createElement('span'); content.textContent = post.sharedPost.content;
    shared.append(label, content); card.append(shared); }
  const actions = document.createElement('div'); actions.className = 'feed-card-actions';
  const like = button(`♥ ${post.likesCount}`, async () => {
    if (post.liked) return; await request(`/api/posts/${post.id}/like`, { method: 'POST' });
    post.liked = true; post.likesCount++; like.textContent = `♥ ${post.likesCount}`; like.setAttribute('aria-pressed', 'true');
  }); like.setAttribute('aria-pressed', String(post.liked)); if (post.userId !== me.id) actions.append(like);
  const comments = document.createElement('section'); comments.className = 'feed-comments hidden';
  const commentButton = button(`💬 ${post.commentsCount}`, () => openComments(post, comments, commentButton), 'feed-comment-toggle');
  actions.append(commentButton);
  const save = button(post.saved ? '★ Salvo' : '☆ Salvar', async () => {
    const target = !post.saved;
    await request(`/api/social/posts/${post.id}/save`, { method: target ? 'PUT' : 'DELETE' });
    post.saved = target; save.textContent = target ? '★ Salvo' : '☆ Salvar'; save.setAttribute('aria-pressed', String(target));
    if (!target && mode === 'saved') card.remove();
  }); save.setAttribute('aria-pressed', String(post.saved)); actions.append(save);
  if (!post.sharedPostId) actions.append(button(`↗ Compartilhar${post.sharesCount ? ` (${post.sharesCount})` : ''}`, () => {
    dialogPostId = post.id; $('share-status').textContent = ''; $('share-form').reset(); $('share-dialog').showModal();
  }));
  if (post.userId !== me.id) {
    actions.append(button('Ocultar', async () => { await request(`/api/social/posts/${post.id}/hide`, { method: 'PUT' });
      card.remove(); $('feed-status').replaceChildren('Publicação ocultada do seu feed. ',
        button('Desfazer', async () => { await request(`/api/social/posts/${post.id}/hide`, { method: 'DELETE' });
          await loadFeed(); })); }));
    actions.append(button('Denunciar', () => { dialogPostId = post.id; $('report-status').textContent = '';
      $('report-form').reset(); $('report-dialog').showModal(); }));
  }
  card.append(actions, comments); return card;
}

async function loadFeed(reset = true) {
  const serial = ++sequence;
  if (reset) { cursor = null; $('feed-list').replaceChildren(); $('feed-status').textContent = 'Carregando posts...'; }
  $('feed-more').disabled = true;
  try {
    const query = new URLSearchParams({ mode }); if (cursor) query.set('cursor', cursor);
    const data = await request(`/api/social/feed?${query}`);
    if (serial !== sequence) return;
    for (const post of data.posts) $('feed-list').append(renderPost(post));
    cursor = data.nextCursor; $('feed-more').classList.toggle('hidden', !cursor);
    $('feed-status').textContent = $('feed-list').childElementCount ? '' :
      mode === 'saved' ? 'Você ainda não salvou publicações.' : 'Ainda não há posts por aqui.';
  } catch (error) { if (serial === sequence) $('feed-status').textContent = error.message; }
  finally { if (serial === sequence) $('feed-more').disabled = false; }
}

async function openSingle(postId) {
  $('feed-list').replaceChildren(); $('feed-status').textContent = 'Carregando publicação...';
  $('feed-more').classList.add('hidden');
  try { const { post } = await request(`/api/social/posts/${encodeURIComponent(postId)}`);
    const card = renderPost(post); $('feed-list').append(card); $('feed-status').textContent = '';
    const comments = card.querySelector('.feed-comments');
    await openComments(post, comments, card.querySelector('.feed-comment-toggle'));
    comments.classList.remove('hidden');
    if (!location.hash.startsWith('#comment-')) card.scrollIntoView({ block: 'start' });
  } catch (error) { $('feed-status').textContent = error.message; }
}

for (const tab of document.querySelectorAll('[data-feed-mode]')) tab.addEventListener('click', () => {
  mode = tab.dataset.feedMode;
  document.querySelectorAll('[data-feed-mode]').forEach(node => node.setAttribute('aria-selected', String(node === tab)));
  history.replaceState(null, '', `/feed.html?mode=${mode}`);
  void loadFeed();
});
$('feed-more').addEventListener('click', () => loadFeed(false));
$('feed-compose').addEventListener('submit', async event => {
  event.preventDefault(); const send = event.currentTarget.querySelector('button[type=submit]'); send.disabled = true;
  try { await request('/api/posts', { method: 'POST', body: JSON.stringify({
    content: $('feed-content').value, roomId: $('feed-room').value || null }) });
    $('feed-content').value = ''; history.replaceState(null, '', `/feed.html?mode=${mode}`);
    $('feed-status').textContent = 'Post publicado.'; await loadFeed();
  } catch (error) { $('feed-status').textContent = error.message; } finally { send.disabled = false; }
});
$('share-form').addEventListener('submit', async event => {
  event.preventDefault(); const send = event.currentTarget.querySelector('button[type=submit]'); send.disabled = true;
  try { await request(`/api/social/posts/${dialogPostId}/share`, { method: 'POST', body: JSON.stringify({
    content: $('share-comment').value, roomId: $('share-room').value || null }) });
    $('share-dialog').close(); history.replaceState(null, '', `/feed.html?mode=${mode}`);
    $('feed-status').textContent = 'Post compartilhado.'; await loadFeed();
  } catch (error) { $('share-status').textContent = error.message; } finally { send.disabled = false; }
});
$('report-form').addEventListener('submit', async event => {
  event.preventDefault(); const send = event.currentTarget.querySelector('button[type=submit]'); send.disabled = true;
  try { await request(`/api/social/posts/${dialogPostId}/report`, { method: 'POST', body: JSON.stringify({
    reason: $('report-reason').value, details: $('report-details').value }) });
    $('report-dialog').close(); $('feed-status').textContent = 'Denúncia recebida.';
  } catch (error) { $('report-status').textContent = error.message; } finally { send.disabled = false; }
});

async function initialize() {
  try {
    const [self, membership] = await Promise.all([request('/api/auth/me'), request('/api/social/my-communities')]);
    me = self.user;
    if (typeof io === 'function') window.ChatNotificationBadge?.attachSocket(io({ auth: { token } }));
    for (const room of membership.rooms) for (const id of ['feed-room', 'share-room'])
      $(id).add(new Option(room.name, room.id));
    document.querySelectorAll('[data-feed-mode]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.feedMode === mode)));
    if (params.get('post')) await openSingle(params.get('post'));
    else await loadFeed();
  } catch (error) { $('feed-status').textContent = error.message; }
}
if (token) void initialize();
