self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json() || {}; } catch { data = {}; }
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'notifications-updated' });
    if (clients.some(client => client.visibilityState === 'visible')) return;
    const href = typeof data.href === 'string' && /^\/(?!\/)/.test(data.href) ? data.href : '/notifications.html';
    await self.registration.showNotification(String(data.title || 'Purpverse'), {
      body: String(data.body || 'Você tem uma nova notificação.'),
      icon: '/image/purpverse-dark.png',
      tag: data.id ? `chat-amino-${data.id}` : undefined,
      data: { href },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const href = event.notification.data?.href || '/notifications.html';
    const target = new URL(href, self.location.origin).href;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); await existing.focus(); }
    else await self.clients.openWindow(target);
  })());
});
