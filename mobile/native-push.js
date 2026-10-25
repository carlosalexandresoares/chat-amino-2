import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

if (Capacitor.isNativePlatform()) {
  const platform = Capacitor.getPlatform();
  const tokenKey = 'purp-native-push-token';
  let pending;
  let status = '';
  const auth = () => localStorage.getItem('authToken');
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${auth()}`,
    } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Falha nas notificações.');
    return data;
  };
  const inform = message => {
    status = message;
    window.dispatchEvent(new CustomEvent('purp-native-push-status', { detail: message }));
  };
  PushNotifications.addListener('registration', async ({ value }) => {
    try {
      localStorage.setItem(tokenKey, value);
      await request('/api/notifications/native-push/devices', { method: 'PUT',
        body: JSON.stringify({ platform, token: value }) });
      sessionStorage.setItem('purp-native-push-synced', '1');
      inform('Dispositivo inscrito. Escolha as categorias Push abaixo.');
      pending?.resolve();
    } catch (error) { inform(error.message); pending?.reject(error); }
    pending = null;
  });
  PushNotifications.addListener('registrationError', error => {
    inform(error.error || 'Falha ao registrar notificações.');
    pending?.reject(new Error(status)); pending = null;
  });
  PushNotifications.addListener('pushNotificationReceived', () =>
    window.ChatNotificationBadge?.refresh());
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const href = notification.data?.href;
    location.href = typeof href === 'string' && /^\/(?!\/)[^\\\r\n]*$/.test(href)
      ? href : '/notifications.html';
  });

  window.PurpNativePush = Object.freeze({
    isEnabled: () => Boolean(localStorage.getItem(tokenKey)),
    status: () => status,
    async available() {
      const config = await request('/api/notifications/native-push/config');
      return Boolean(config.available?.[platform]);
    },
    async enable() {
      if (!auth()) throw new Error('Entre na sua conta primeiro.');
      if (!await this.available()) throw new Error('Notificações nativas ainda não configuradas neste servidor.');
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') throw new Error('Permissão de notificações não concedida.');
      if (pending) return;
      const registered = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending = null; reject(new Error('Registro demorou a responder.')); }, 10000);
        pending = { resolve: () => { clearTimeout(timeout); resolve(); },
          reject: error => { clearTimeout(timeout); reject(error); } };
      });
      try { await PushNotifications.register(); }
      catch (error) { pending?.reject(error); pending = null; }
      await registered;
    },
    async disable() {
      const token = localStorage.getItem(tokenKey);
      let unregisterError;
      try { await PushNotifications.unregister(); }
      catch (error) { unregisterError = error; }
      localStorage.removeItem(tokenKey);
      sessionStorage.removeItem('purp-native-push-synced');
      if (token && auth()) await request('/api/notifications/native-push/devices', { method: 'DELETE',
        body: JSON.stringify({ platform, token }) });
      if (unregisterError) throw unregisterError;
      inform('Notificações desativadas neste dispositivo.');
    },
  });
  if (auth() && localStorage.getItem(tokenKey) &&
      !sessionStorage.getItem('purp-native-push-synced'))
    PushNotifications.register().catch(() => {});
}
