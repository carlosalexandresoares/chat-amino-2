import { Capacitor, registerPlugin } from '@capacitor/core';

if (Capacitor.getPlatform() === 'android') {
  const updater = registerPlugin('PurpUpdate');
  const style = document.createElement('style');
  style.textContent = `
    .purp-update-dialog{border:1px solid #7146ad;border-radius:18px;background:#1b102d;color:#fff;
      max-width:min(92vw,420px);padding:24px;box-shadow:0 24px 70px #000a;font:inherit}
    .purp-update-dialog::backdrop{background:#080312b8}
    .purp-update-dialog h2{margin:0 0 10px;font-size:1.35rem}
    .purp-update-dialog p{line-height:1.5;color:#ddd0f2}
    .purp-update-dialog .actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:20px}
    .purp-update-dialog button,.purp-update-check{border-radius:10px;padding:10px 16px;cursor:pointer;
      border:1px solid #8556cb;background:#7028cf;color:white;font:inherit}
    .purp-update-dialog button.secondary{background:transparent}
    .purp-update-dialog button:disabled{opacity:.6;cursor:wait}
    .purp-update-dialog [role=status]{min-height:1.5em;margin-bottom:0;font-size:.9rem}
  `;
  document.head.appendChild(style);

  let checking = false;
  async function checkForUpdate(manual = false) {
    if (checking) return;
    checking = true;
    try {
      const [installed, response] = await Promise.all([
        updater.getVersion(), fetch('/api/app-updates/android', { cache: 'no-store' }),
      ]);
      if (!response.ok) throw new Error('Não foi possível consultar as atualizações.');
      const release = await response.json();
      if (!Number.isInteger(release.versionCode) || !release.downloadUrl || !release.sha256)
        throw new Error('Dados da atualização incompletos.');
      if (release.versionCode <= installed.versionCode) {
        if (manual) alert(`Purp ${installed.versionName} está atualizado.`);
        return;
      }
      const dialog = document.createElement('dialog');
      dialog.className = 'purp-update-dialog';
      dialog.innerHTML = `<h2>Atualização do Purp</h2><p></p><p role="status"></p>
        <div class="actions"><button type="button" class="secondary">Mais tarde</button>
        <button type="button" class="install">Atualizar agora</button></div>`;
      dialog.querySelector('p').textContent = `A versão ${release.versionName} está disponível. O Android pedirá sua confirmação para instalar.`;
      const status = dialog.querySelector('[role=status]');
      const button = dialog.querySelector('.install');
      dialog.querySelector('.secondary').onclick = () => dialog.close();
      dialog.addEventListener('close', () => dialog.remove());
      button.onclick = async () => {
        button.disabled = true;
        try {
          const current = await updater.getVersion();
          if (!current.canInstall) {
            status.textContent = 'Permita a instalação pelo Purp nas configurações do Android e toque novamente em Atualizar agora.';
            await updater.openInstallSettings();
            return;
          }
          status.textContent = 'Baixando e verificando o APK…';
          await updater.installUpdate({ url: release.downloadUrl, sha256: release.sha256 });
          status.textContent = 'Confirme a instalação na tela do Android.';
        } catch (error) {
          status.textContent = error?.message || 'Falha na atualização. Tente novamente.';
        } finally {
          button.disabled = false;
        }
      };
      document.body.appendChild(dialog);
      dialog.showModal();
    } catch (error) {
      if (manual) alert(error?.message || 'Não foi possível consultar as atualizações.');
    } finally {
      checking = false;
    }
  }

  function ready() {
    const actions = document.querySelector('.profile-actions');
    if (actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'purp-update-check';
      button.textContent = 'Verificar atualizações do app';
      button.addEventListener('click', () => checkForUpdate(true));
      actions.insertBefore(button, actions.querySelector('#logout-button'));
    }
    setTimeout(() => checkForUpdate(), 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
}
