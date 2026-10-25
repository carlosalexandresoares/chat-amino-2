const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '..', 'public');
const output = path.resolve(__dirname, 'www');
if (path.dirname(output) !== __dirname || !fs.statSync(source).isDirectory())
  throw new Error('Diretórios do pacote mobile inválidos.');
const backend = new URL(process.env.PURP_SERVER_URL || 'https://project-dacj.onrender.com');
if (backend.protocol !== 'https:' && !(backend.protocol === 'http:' &&
  ['localhost', '127.0.0.1'].includes(backend.hostname)))
  throw new Error('PURP_SERVER_URL deve usar HTTPS ou localhost para desenvolvimento.');

fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, { recursive: true });
const socketClient = require.resolve('socket.io-client/dist/socket.io.js');
fs.mkdirSync(path.join(output, 'socket.io'), { recursive: true });
fs.copyFileSync(socketClient, path.join(output, 'socket.io', 'socket.io.js'));
const adapter = fs.readFileSync(path.join(__dirname, 'platform-runtime.js'), 'utf8');
fs.writeFileSync(path.join(output, 'platform-runtime.js'),
  adapter.replace('__PURP_SERVER_ORIGIN__', JSON.stringify(backend.origin)));
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'native-push.js')],
  outfile: path.join(output, 'native-push.js'), bundle: true, platform: 'browser', format: 'iife' });
for (const file of fs.readdirSync(output).filter(name => name.endsWith('.html'))) {
  const target = path.join(output, file);
  let html = fs.readFileSync(target, 'utf8');
  if (!html.trim()) continue;
  if (!html.includes('<head>') || !html.includes('</head>'))
    throw new Error(`Página sem head: ${file}`);
  html = html.replace('<head>', '<head>\n<script src="/platform-runtime.js"></script>');
  html = html.replace('</head>', '<script src="/native-push.js"></script>\n</head>');
  fs.writeFileSync(target, html);
}
console.log(`Interface mobile preparada em ${output} para ${backend.origin}`);
