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

  const offerKey = 'purp-native-push-offer-dismissed';
  async function offerNotifications() {
    if (!auth() || localStorage.getItem(tokenKey) || localStorage.getItem(offerKey) ||
        location.pathname === '/notifications.html' || !await window.PurpNativePush.available().catch(() => false)) return;
    const banner = document.createElement('aside');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Notificações de mensagens');
    banner.style.cssText = 'position:fixed;z-index:10000;left:16px;right:16px;bottom:80px;max-width:420px;margin:auto;padding:16px;border:1px solid #8556cb;border-radius:16px;background:#211138;color:#fff;box-shadow:0 12px 35px #0009;font:inherit';
    const message = document.createElement('p');
    message.textContent = 'Receba avisos no celular quando chegarem mensagens no Chat Geral ou no privado.';
    message.style.margin = '0 0 12px';
    const enable = document.createElement('button');
    enable.type = 'button'; enable.textContent = 'Ativar notificações';
    const later = document.createElement('button');
    later.type = 'button'; later.textContent = 'Depois';
    for (const button of [enable, later]) button.style.cssText = 'margin-right:8px;padding:9px 12px;border-radius:8px;border:1px solid #8556cb;background:#7028cf;color:white;font:inherit';
    later.style.background = 'transparent';
    later.onclick = () => { localStorage.setItem(offerKey, '1'); banner.remove(); };
    enable.onclick = async () => {
      enable.disabled = true;
      try { await window.PurpNativePush.enable(); banner.remove(); }
      catch (error) { message.textContent = error.message || 'Falha ao ativar notificações.'; enable.disabled = false; }
    };
    banner.append(message, enable, later);
    document.body.appendChild(banner);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(offerNotifications, 3500));
  else setTimeout(offerNotifications, 3500);
}
