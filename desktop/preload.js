const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('purpDesktop', Object.freeze({
  notify(notification) {
    if (!notification || typeof notification !== 'object') return;
    ipcRenderer.send('purp:notification', {
      title: String(notification.title || 'Purp').slice(0, 120),
      body: String(notification.body || '').slice(0, 240),
      href: typeof notification.href === 'string' && /^\/(?!\/)[^\\\r\n]*$/.test(notification.href)
        ? notification.href.slice(0, 500) : '/notifications.html',
    });
  },
}));
