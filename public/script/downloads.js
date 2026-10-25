function setDownload(platform, ready) {
  const link = document.getElementById(`download-${platform}`);
  if (!link) return;
  if (ready) {
    link.href = `/downloads/${platform}`;
    link.download = platform === 'android' ? 'Purp-Android-teste.apk' : 'Purp-Windows-Setup.exe';
    link.classList.remove('unavailable');
    link.removeAttribute('aria-disabled');
    link.textContent = platform === 'android' ? 'Baixar para Android' : 'Baixar para Windows';
  } else {
    link.removeAttribute('href');
    link.removeAttribute('download');
    link.classList.add('unavailable');
    link.setAttribute('aria-disabled', 'true');
    link.textContent = 'Download indisponível';
  }
}

fetch('/api/downloads', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error('Não foi possível verificar os downloads.');
    return response.json();
  })
  .then(({ android, windows }) => {
    setDownload('android', android === true);
    setDownload('windows', windows === true);
  })
  .catch(() => {
    setDownload('android', false);
    setDownload('windows', false);
  });
