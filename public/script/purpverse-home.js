(() => {
  const token = localStorage.getItem('authToken');
  if (!token) return;
  const byId = id => document.getElementById(id);
  const short = (value, limit = 135) => value?.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value || '';
  const date = value => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  async function request(path) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Não foi possível carregar esta seção.');
    return response.json();
  }
  function item(parent, { href, title, detail, meta }) {
    const anchor = document.createElement('a');
    anchor.className = 'pv-home-item';
    anchor.href = href;
    const heading = document.createElement('strong');
    heading.textContent = title;
    const content = document.createElement('p');
    content.textContent = detail;
    anchor.append(heading, content);
    if (meta) {
      const small = document.createElement('small');
      small.textContent = meta;
      anchor.append(small);
    }
    parent.append(anchor);
  }
  function empty(parent, message, href, linkText) {
    const text = document.createElement('p');
    text.className = 'pv-home-empty';
    text.textContent = message;
    parent.append(text);
    if (href) {
      const link = document.createElement('a');
      link.className = 'pv-home-empty-link';
      link.href = href;
      link.textContent = linkText;
      parent.append(link);
    }
  }
  async function fill(id, path, render, fallback) {
    const parent = byId(id);
    if (!parent) return;
    try {
      const data = await request(path);
      parent.replaceChildren();
      render(parent, data);
    } catch {
      parent.replaceChildren();
      empty(parent, fallback);
    }
  }
  function init() {
    fill('pv-home-posts', '/api/social/feed?mode=forYou', (parent, data) => {
      const posts = data.posts?.slice(0, 2) || [];
      if (!posts.length) return empty(parent, 'Ainda não há publicações por aqui.', '/feed.html', 'Conhecer o feed ↗');
      posts.forEach(post => item(parent, { href: `/feed.html?post=${encodeURIComponent(post.id)}`, title: post.user?.username || 'Comunidade', detail: short(post.content || post.sharedPost?.content), meta: post.room?.name || 'Publicação no perfil' }));
    }, 'Feed indisponível no momento.');
    fill('pv-home-events', '/api/events?page=1', (parent, data) => {
      const events = data.events?.slice(0, 2) || [];
      if (!events.length) return empty(parent, 'Nenhum evento próximo.', '/events.html', 'Explorar eventos ↗');
      events.forEach(event => item(parent, { href: `/events.html?eventId=${encodeURIComponent(event.id)}`, title: event.title, detail: `${event.room?.name || 'Comunidade'} · ${date(event.startsAt)}`, meta: event.type === 'PROJECTION' ? 'Projeção' : 'Evento' }));
    }, 'Agenda indisponível no momento.');
    fill('pv-home-projections', '/api/projections/active', (parent, data) => {
      const projections = data.projections?.slice(0, 3) || [];
      if (!projections.length) return empty(parent, 'Nenhuma projeção ao vivo agora.', '/index.html?sala=geral#projections', 'Ir para projeções ↗');
      projections.forEach(projection => item(parent, { href: `/index.html?sala=${encodeURIComponent(projection.roomId)}#projections`, title: projection.roomName, detail: 'Assistindo juntos agora', meta: `Ao vivo · desde ${date(projection.startedAt)}` }));
    }, 'Projeções indisponíveis no momento.');
    fill('pv-home-friends', '/api/social/feed?mode=following', (parent, data) => {
      const posts = data.posts?.slice(0, 2) || [];
      if (!posts.length) return empty(parent, 'Acompanhe pessoas para ver a atividade delas aqui.', '/feed.html', 'Descobrir pessoas ↗');
      posts.forEach(post => item(parent, { href: `/feed.html?post=${encodeURIComponent(post.id)}`, title: post.user?.username || 'Pessoa', detail: short(post.content || post.sharedPost?.content, 90), meta: post.room?.name || 'Novo post' }));
    }, 'Atividade indisponível no momento.');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
