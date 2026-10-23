(() => {
  const storageKey = 'purpverse-theme';
  const saved = (() => { try { return localStorage.getItem(storageKey); } catch { return null; } })();
  const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark' ? saved : preferred;
  function syncBrowserChrome() {
    const light = document.documentElement.dataset.theme === 'light';
    document.querySelector('link[rel="icon"]')?.setAttribute('href', '/image/purp-mascot.png');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f8f3ff' : '#0b0716');
  }
  syncBrowserChrome();

  const destinations = [
    { href: '/index.html', icon: '▤', label: 'Chats', key: 'chats' },
    { href: '/index.html#communities', icon: '◎', label: 'Comunidades', key: 'communities' },
    { href: '/index.html?sala=geral#projections', icon: '▣', label: 'Projeções', key: 'projections' },
    { href: '/perfil.html', icon: '◉', label: 'Perfil', key: 'profile' },
  ];
  const activeKey = () => {
    const path = location.pathname;
    if (path.endsWith('perfil.html') || path.endsWith('editar-perfil.html') || path.endsWith('gamification.html')) return 'profile';
    if (path.endsWith('index.html') && location.hash === '#communities') return 'communities';
    if (path.endsWith('index.html') && location.hash === '#projections') return 'projections';
    if (path.endsWith('index.html') || path.endsWith('direct.html')) return 'chats';
    return '';
  };

  function themeButton(small = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pv-theme-toggle${small ? ' pv-theme-toggle--small' : ''}`;
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(storageKey, next); } catch { /* Storage can be unavailable in private mode. */ }
      document.querySelectorAll('.pv-theme-toggle').forEach(syncThemeButton);
      syncBrowserChrome();
    });
    syncThemeButton(button);
    return button;
  }
  function syncThemeButton(button) {
    const light = document.documentElement.dataset.theme === 'light';
    button.setAttribute('aria-label', light ? 'Ativar modo noturno' : 'Ativar modo claro');
    button.title = light ? 'Modo noturno' : 'Modo claro';
    button.innerHTML = `<span aria-hidden="true">${light ? '☾' : '☼'}</span><span class="pv-theme-label">${light ? 'Escuro' : 'Claro'}</span>`;
  }

  function link(destination, mobile = false) {
    const anchor = document.createElement('a');
    anchor.href = destination.href;
    if (destination.key === activeKey()) anchor.setAttribute('aria-current', 'page');
    const icon = document.createElement('span');
    icon.className = mobile ? '' : 'pv-sidebar-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = destination.icon;
    const label = document.createElement('small');
    label.textContent = destination.label;
    anchor.append(icon, label);
    return anchor;
  }

  function init() {
    const path = location.pathname;
    const auth = path.endsWith('/login.html') || path.endsWith('/cadastro.html');
    if (auth) {
      document.querySelector('.auth-card-heading')?.prepend(themeButton());
      return;
    }
    if (window !== window.top || path.endsWith('/pip-host.html')) return;
    const policy = path.endsWith('/rules.html') || path.endsWith('/privacy.html');
    if (policy) {
      document.body.prepend(themeButton());
      return;
    }
    document.body.classList.add('pv-shell');
    const sidebar = document.createElement('nav');
    sidebar.className = 'pv-sidebar';
    sidebar.setAttribute('aria-label', 'Navegação principal');
    const brand = document.createElement('a');
    brand.href = '/index.html';
    brand.className = 'pv-sidebar-brand';
    brand.setAttribute('aria-label', 'Purp, início');
    brand.innerHTML = '<span class="pv-logo" aria-hidden="true"></span>';
    sidebar.append(brand);
    destinations.forEach(destination => sidebar.append(link(destination)));
    const spacer = document.createElement('span');
    spacer.className = 'pv-sidebar-spacer';
    sidebar.append(spacer);
    const feed = document.createElement('a');
    feed.href = '/feed.html';
    feed.innerHTML = '<span class="pv-sidebar-icon" aria-hidden="true">✦</span><small>Feed</small>';
    if (path.endsWith('/feed.html')) feed.setAttribute('aria-current', 'page');
    sidebar.append(feed, themeButton(true));
    document.body.prepend(sidebar);

    const existingNav = document.querySelector('.mobile-bottom-nav, .dm-bottom-nav, .notification-bottom-nav');
    if (!existingNav) {
      const mobile = document.createElement('nav');
      mobile.className = 'pv-mobile-nav';
      mobile.setAttribute('aria-label', 'Navegação principal');
      destinations.forEach(destination => mobile.append(link(destination, true)));
      document.body.append(mobile);
      document.body.classList.add('pv-extra-nav');
    }
    if (window.visualViewport) {
      const syncKeyboard = () => document.body.classList.toggle('mobile-keyboard-open',
        window.innerHeight - window.visualViewport.height > 140);
      window.visualViewport.addEventListener('resize', syncKeyboard);
      syncKeyboard();
    }
    const composer = document.querySelector('.app-screen .container-chat');
    if (composer && 'ResizeObserver' in window) {
      const syncComposerHeight = () => composer.closest('.chat-area')?.style.setProperty('--pv-composer-height', `${composer.getBoundingClientRect().height}px`);
      new ResizeObserver(syncComposerHeight).observe(composer);
      syncComposerHeight();
    }
    const header = document.querySelector('.rooms-topbar, .feed-header nav, .events-topbar nav, .game-topbar nav, .dm-brand, .notifications-header, .profile-nav, .page-header, .admin-header nav');
    if (header) header.append(themeButton(true));
    const roomMenu = document.getElementById('room-options-menu');
    if (roomMenu) {
      const toggle = themeButton();
      toggle.setAttribute('role', 'menuitem');
      roomMenu.append(toggle);
    }
    window.addEventListener('hashchange', () => {
      document.querySelectorAll('.pv-sidebar a, .pv-mobile-nav a').forEach(anchor => {
        const destination = destinations.find(item => item.href === anchor.getAttribute('href'));
        if (destination?.key === activeKey()) anchor.setAttribute('aria-current', 'page');
        else anchor.removeAttribute('aria-current');
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
