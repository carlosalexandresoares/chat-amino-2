(() => {
  const token = localStorage.getItem('authToken');
  let timer;
  async function refresh() {
    if (!token) return;
    try {
      const response = await fetch('/api/notifications/unread-count', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const { unreadCount } = await response.json();
      document.querySelectorAll('.notification-badge').forEach(badge => {
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.classList.toggle('hidden', !unreadCount);
      });
    } catch { /* O sino mantém o último estado se a rede cair. */ }
  }
  function scheduleRefresh() { clearTimeout(timer); timer = setTimeout(refresh, 120); }
  function attachSocket(socket) {
    if (!socket) return;
    for (const event of ['connect', 'notification', 'notification-read', 'notifications-read-all', 'notification-deleted'])
      socket.on(event, scheduleRefresh);
  }
  window.ChatNotificationBadge = { attachSocket, refresh: scheduleRefresh };
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'notifications-updated') scheduleRefresh();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
})();
