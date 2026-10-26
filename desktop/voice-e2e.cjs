// Run with: cd desktop && npx electron voice-e2e.cjs
// Uses three isolated Electron renderers, a mock voice-room server and real WebRTC.
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const members = new Map();
const windows = new Map();
let server;
let baseUrl;

function participant(id) {
  const member = members.get(id);
  return { socketId: id, userId: id, username: member.username, avatar: null,
    muted: member.muted, forcedMuted: false, speaking: false, sharing: member.sharing };
}
function send(id, name, payload) {
  windows.get(id)?.webContents.send('test:event', { name, payload });
}
function broadcastMembers() {
  const participants = [...members.keys()].map(participant);
  for (const id of members.keys()) send(id, 'voice:participants',
    { voiceRoomId: 'voice-test-room', participants });
}
function removeMember(id) {
  if (!members.delete(id)) return;
  for (const remaining of members.keys()) send(remaining, 'voice:peer-left',
    { voiceRoomId: 'voice-test-room', socketId: id });
  broadcastMembers();
}
function reply(event, ack, result) {
  if (ack) event.sender.send('test:ack', { ack, result });
}
ipcMain.on('test:emit', (event, { userId, name, payload = {}, ack }) => {
  if (event.sender !== windows.get(userId)?.webContents) return;
  let result = { success: true };
  if (name === 'voice:list') {
    result.rooms = [{ id: 'voice-test-room', name: 'Sala de teste', participantCount: members.size,
      maxParticipants: 6, projectionActive: false }];
  } else if (name === 'voice:join') {
    if (members.has(userId)) result = { success: false };
    else {
      const peers = [...members.keys()].map(participant);
      members.set(userId, { username: `Teste ${userId}`, muted: false, sharing: false });
      result = { success: true, room: { id: 'voice-test-room', name: 'Sala de teste', roomId: 'geral' },
        peers, self: participant(userId), iceServers: [] };
      setTimeout(broadcastMembers, 0);
    }
  } else if (name === 'voice:self-mute') {
    const member = members.get(userId);
    if (!member) result = { success: false };
    else { member.muted = payload.muted; result.muted = member.muted; broadcastMembers(); }
  } else if (name === 'voice:share') {
    const member = members.get(userId);
    if (!member || (payload.sharing && [...members.values()].some(other => other !== member && other.sharing)))
      result = { success: false, message: 'Outra pessoa já está compartilhando a tela.' };
    else { member.sharing = payload.sharing; broadcastMembers(); }
  } else if (name === 'voice:signal') {
    if (!members.has(userId) || !members.has(payload.to)) result = { success: false };
    else send(payload.to, 'voice:signal', { from: userId, type: payload.type, data: payload.data });
  } else if (name === 'voice:leave') {
    removeMember(userId);
  }
  reply(event, ack, result);
});

async function waitFor(win, condition, label, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await win.webContents.executeJavaScript(condition)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout: ${label}`);
}
async function openClient(id) {
  const win = new BrowserWindow({ show: false, webPreferences: {
    nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false,
  } });
  windows.set(id, win);
  win.webContents.on('did-start-navigation', (_event, _details) => removeMember(id));
  await win.loadURL(`${baseUrl}/voice-e2e.html?id=${id}&sala=geral`);
  await waitFor(win, 'window.voiceTestReady === true', `${id} iniciou`);
  await waitFor(win, "document.querySelector('#voice-room-list button') !== null", `${id} listou sala`);
  return win;
}
async function click(win, selector) {
  await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function join(win, watchOnly = false) {
  const label = watchOnly ? 'Só assistir' : 'Entrar';
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#voice-room-list button'))
    .find(button => button.textContent === ${JSON.stringify(label)}).click()`);
  await waitFor(win, "!document.querySelector('#voice-dock').classList.contains('hidden')", 'entrou na chamada');
  await click(win, '#voice-dock-expand');
}
async function streamVisible(win, label) {
  await waitFor(win, `document.querySelector('#voice-screen-video').videoWidth > 0 &&
    !document.querySelector('#voice-screen-view').classList.contains('hidden')`, label);
}

async function run() {
  await app.whenReady();
  server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, baseUrl).pathname;
    const file = pathname === '/voice-e2e.html'
      ? path.join(__dirname, 'voice-e2e.html')
      : ['/script/voice.js', '/script/state.js'].includes(pathname)
        ? path.join(__dirname, '..', 'public', pathname.slice(1)) : null;
    if (!file) { response.writeHead(404); response.end(); return; }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': pathname.endsWith('.js')
        ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map(openClient));
  await join(a);
  await join(b, true);
  await join(c, true);
  await waitFor(b, `Array.from(document.querySelectorAll('audio')).some(audio =>
    audio.srcObject?.getAudioTracks().length)`, 'áudio da chamada recebido');
  await click(a, '#voice-screen-share');
  await Promise.all([streamVisible(b, 'B recebeu tela'), streamVisible(c, 'C recebeu tela')]);
  await waitFor(b, `Array.from(document.querySelectorAll('audio')).some(audio =>
    audio.srcObject?.getAudioTracks().some(track => track.readyState === 'live'))`,
    'áudio permaneceu durante a transmissão');
  const d = await openClient('d');
  await join(d, true);
  await streamVisible(d, 'D entrou durante a transmissão e recebeu tela');
  const captureOptions = await a.webContents.executeJavaScript('window.captureOptions');
  if (captureOptions.video.frameRate.max !== 30 || captureOptions.video.height.max !== 720)
    throw new Error('Limites de qualidade não aplicados');
  await click(a, '#voice-screen-share');
  await waitFor(b, "document.querySelector('#voice-screen-view').classList.contains('hidden')",
    'parada propagada');
  await click(b, '#voice-screen-share');
  await Promise.all([streamVisible(a, 'A recebeu tela de B'), streamVisible(c, 'C recebeu tela de B'),
    streamVisible(d, 'D recebeu tela de B')]);
  await waitFor(c, `Array.from(document.querySelectorAll('audio')).some(audio =>
    audio.srcObject?.getAudioTracks().some(track => track.readyState === 'live'))`,
    'áudio permaneceu com outro transmissor');
  await click(a, '#voice-screen-close');
  await waitFor(a, "!document.querySelector('#voice-screen-watch').classList.contains('hidden')",
    'sair da visualização');
  await click(a, '#voice-screen-watch');
  await streamVisible(a, 'retomou visualização');
  await click(b, '#voice-screen-share');
  await click(a, '#voice-screen-share');
  await streamVisible(b, 'B recebeu segunda transmissão de A');
  await a.webContents.executeJavaScript(`window.lastCapture.getVideoTracks()[0]
    .dispatchEvent(new Event('ended'))`);
  await waitFor(b, "document.querySelector('#voice-screen-view').classList.contains('hidden')",
    'parada pelo seletor do sistema propagada');
  await a.webContents.executeJavaScript(`Object.defineProperty(navigator.mediaDevices,
    'getDisplayMedia', { configurable: true, value: async () => {
      throw new DOMException('Permissão negada', 'NotAllowedError');
    } })`);
  await click(a, '#voice-screen-share');
  await waitFor(a, "document.querySelector('#voice-dock-status').textContent.includes('cancelado')",
    'permissão negada tratada');
  if ([...members.values()].some(member => member.sharing)) throw new Error('Estado da tela não foi limpo');
  await click(b, '#voice-screen-share');
  await streamVisible(a, 'A recebeu vídeo antes da reconexão');
  await a.reload();
  await waitFor(a, 'window.voiceTestReady === true', 'A reconectou');
  await join(a);
  await streamVisible(a, 'A recebeu vídeo após reconexão');
  await waitFor(c, `Array.from(document.querySelectorAll('audio')).some(audio =>
    audio.srcObject?.getAudioTracks().length)`, 'áudio restabelecido após reconexão');
  await click(b, '#voice-screen-share');
  await b.webContents.executeJavaScript('window.testStartNativeShare(["a", "c", "d"])');
  await Promise.all([streamVisible(a, 'A recebeu tela Android simulada'),
    streamVisible(c, 'C recebeu tela Android simulada'),
    streamVisible(d, 'D recebeu tela Android simulada')]);
  await b.webContents.executeJavaScript('window.testStopNativeShare()');
  await waitFor(a, "document.querySelector('#voice-screen-view').classList.contains('hidden')",
    'fim da transmissão Android simulada');
  process.stdout.write('PASS: 4 clientes WebRTC, áudio, vídeo web e Android simulado, vários espectadores, entrada tardia, paradas, reconexão, visualização e permissão negada.\n');
}

run().then(() => finish(0), error => {
  process.stderr.write(`${error.stack || error}\n`);
  finish(1);
});
function finish(code) {
  for (const win of windows.values()) if (!win.isDestroyed()) win.destroy();
  server?.close();
  app.exit(code);
}
