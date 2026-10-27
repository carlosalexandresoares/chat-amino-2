const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, session, desktopCapturer, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const proxy = require('http-proxy');

const configuredUrl = process.env.PURP_SERVER_URL || 'https://project-dacj.onrender.com';
const backend = new URL(configuredUrl);
if (backend.protocol !== 'https:' && !(backend.protocol === 'http:' &&
  ['localhost', '127.0.0.1'].includes(backend.hostname)))
  throw new Error('PURP_SERVER_URL deve usar HTTPS ou localhost para desenvolvimento.');

const assets = app.isPackaged
  ? path.join(process.resourcesPath, 'public')
  : path.resolve(__dirname, '..', 'public');
const socketClientBundle = path.join(__dirname, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js');
const icon = path.join(assets, 'image', 'purp-mascot.png');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
const upstream = proxy.createProxyServer({ target: backend.origin, changeOrigin: true, ws: true, secure: true });
let server;
let mainWindow;
let tray;
let localOrigin;
let quitting = false;

upstream.on('error', (_error, _request, response) => {
  if (response && !response.headersSent) {
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'Servidor indisponível. Tente novamente.' }));
  }
});

function localRequest(request) {
  return request.headers.host === new URL(localOrigin).host;
}

async function serve(request, response) {
  if (!localRequest(request)) { response.writeHead(403); response.end(); return; }
  const pathname = new URL(request.url, localOrigin).pathname;
  if (pathname === '/socket.io/socket.io.js') {
    try {
      const contents = await fs.readFile(socketClientBundle);
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff' });
      response.end(contents);
    } catch { response.writeHead(503); response.end(); }
    return;
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/socket.io/')) {
    upstream.web(request, response); return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { response.writeHead(400); response.end(); return; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(assets, relative);
  if (!file.startsWith(`${assets}${path.sep}`)) { response.writeHead(403); response.end(); return; }
  try {
    const contents = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      'X-Content-Type-Options': 'nosniff' });
    response.end(contents);
  } catch { response.writeHead(404); response.end(); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 780, minWidth: 380, minHeight: 540, icon,
    show: process.env.PURP_SMOKE !== '1',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  mainWindow.loadURL(localOrigin);
  if (process.env.PURP_SMOKE === '1') mainWindow.webContents.once('did-finish-load', async () => {
    const result = await mainWindow.webContents.executeJavaScript(`(async () => {
      let apiStatus = 0;
      let socketAssetStatus = 0;
      try { apiStatus = (await fetch('/api/auth/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: '{}' })).status; }
      catch { /* O servidor remoto pode estar indisponível. */ }
      try { const asset = await fetch('/socket.io/socket.io.js');
        socketAssetStatus = asset.status;
      } catch { /* Cliente Socket.IO indisponivel. */ }
      return { loginPage: Boolean(document.querySelector('#login-form')),
        appPage: Boolean(document.querySelector('#app-screen, #rooms-screen')),
        socketClient: typeof io === 'function', webRtc: typeof RTCPeerConnection === 'function',
        capture: Boolean(navigator.mediaDevices?.getDisplayMedia), apiStatus,
        socketAssetStatus };
    })()`);
    const ready = (result.loginPage || (result.appPage && result.socketClient)) &&
      result.webRtc && result.capture && result.apiStatus === 400 && result.socketAssetStatus === 200;
    process.stdout.write(`PURP_SMOKE=${JSON.stringify(result)}\n`);
    if (process.env.PURP_SMOKE_FILE && path.isAbsolute(process.env.PURP_SMOKE_FILE))
      await fs.writeFile(process.env.PURP_SMOKE_FILE, JSON.stringify({ ...result, ready }));
    app.quit();
  });
  mainWindow.on('close', event => {
    if (!quitting) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { if (new URL(url).protocol === 'https:') void shell.openExternal(url); } catch { /* URL inválida. */ }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${localOrigin}/`) && url !== localOrigin) event.preventDefault();
  });
}

app.whenReady().then(async () => {
  server = http.createServer((request, response) => { void serve(request, response); });
  server.on('upgrade', (request, socket, head) => {
    if (!localRequest(request) || !request.url.startsWith('/socket.io/')) { socket.destroy(); return; }
    upstream.ws(request, socket, head);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  localOrigin = `http://127.0.0.1:${server.address().port}`;
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    let requestingOrigin;
    try { requestingOrigin = new URL(details.requestingUrl).origin; } catch { /* Origem inválida. */ }
    const trusted = contents === mainWindow?.webContents && requestingOrigin === localOrigin;
    callback(Boolean(trusted && ['media', 'display-capture', 'notifications'].includes(permission)));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => {
    try { return new URL(origin).origin === localOrigin &&
      ['media', 'display-capture', 'notifications'].includes(permission); }
    catch { return false; }
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.securityOrigin !== localOrigin || !request.userGesture) { callback(null); return; }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      if (!sources.length) { callback(null); return; }
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Compartilhar tela', message: 'Escolha o que deseja compartilhar',
        buttons: [...sources.map(source => source.name), 'Cancelar'], cancelId: sources.length,
      });
      if (choice.response >= sources.length) { callback(null); return; }
      const source = sources[choice.response];
      callback({ video: source, ...(source.id.startsWith('screen:') ? { audio: 'loopback' } : {}) });
    } catch { callback(null); }
  });
  createWindow();
  tray = new Tray(icon);
  tray.setToolTip('Purp');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Purp', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
});

ipcMain.on('purp:notification', (event, data) => {
  if (event.sender !== mainWindow?.webContents || !event.sender.getURL().startsWith(localOrigin) ||
      !data || typeof data.title !== 'string' || typeof data.body !== 'string' ||
      typeof data.href !== 'string' || !/^\/(?!\/)[^\\\r\n]*$/.test(data.href)) return;
  if (mainWindow.isFocused()) return;
  const notice = new Notification({ title: data.title.slice(0, 120), body: data.body.slice(0, 240), icon });
  notice.on('click', () => { mainWindow.show(); mainWindow.focus(); mainWindow.loadURL(`${localOrigin}${data.href}`); });
  notice.show();
});

app.on('before-quit', () => { quitting = true; server?.close(); });
app.on('activate', () => { if (mainWindow) mainWindow.show(); else createWindow(); });
