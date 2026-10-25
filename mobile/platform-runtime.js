(() => {
  const backend = __PURP_SERVER_ORIGIN__;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    if (url && new URL(url, location.origin).pathname.startsWith('/api/') &&
        new URL(url, location.origin).origin === location.origin) {
      const remote = backend + new URL(url, location.origin).pathname + new URL(url, location.origin).search;
      return originalFetch(input instanceof Request ? new Request(remote, input) : remote, options);
    }
    return originalFetch(input, options);
  };
  const routeMedia = node => {
    if (!node || !['IMG', 'AUDIO', 'VIDEO', 'SOURCE', 'A'].includes(node.tagName)) return;
    for (const name of ['src', 'href']) {
      const value = node.getAttribute(name);
      if (value?.startsWith('/api/')) node.setAttribute(name, backend + value);
    }
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') routeMedia(record.target);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        routeMedia(node);
        node.querySelectorAll?.('[src^="/api/"], [href^="/api/"]').forEach(routeMedia);
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['src', 'href'] });
  document.addEventListener('DOMContentLoaded', () =>
    document.querySelectorAll('[src^="/api/"], [href^="/api/"]').forEach(routeMedia));
  const wrapSocket = value => {
    if (typeof value !== 'function' || value.__purpWrapped) return value;
    const wrapped = (...args) => typeof args[0] === 'string'
      ? value(...args) : value(backend, args[0]);
    Object.assign(wrapped, value);
    wrapped.__purpWrapped = true;
    return wrapped;
  };
  let socketFactory = wrapSocket(window.io);
  Object.defineProperty(window, 'io', {
    configurable: true,
    enumerable: true,
    get: () => socketFactory,
    set: value => { socketFactory = wrapSocket(value); }
  });
})();
