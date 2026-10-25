const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../mobile/platform-runtime.js'), 'utf8')
  .replace('__PURP_SERVER_ORIGIN__', JSON.stringify('https://project-dacj.onrender.com'));

function loadRuntime(initialSocket) {
  const window = { fetch() {}, io: initialSocket };
  const document = { addEventListener() {}, querySelectorAll() { return []; } };
  const context = { window, document, location: { origin: 'https://localhost' }, URL,
    MutationObserver: class { observe() {} } };
  vm.runInNewContext(source, context);
  return window;
}

test('adaptador mobile preserva Socket.IO carregado antes ou depois dele', () => {
  const socket = (...args) => args;
  const alreadyLoaded = loadRuntime(socket);
  assert.deepEqual(alreadyLoaded.io({ autoConnect: false }),
    ['https://project-dacj.onrender.com', { autoConnect: false }]);

  const loadedLater = loadRuntime(undefined);
  loadedLater.io = socket;
  assert.deepEqual(loadedLater.io({ autoConnect: false }),
    ['https://project-dacj.onrender.com', { autoConnect: false }]);
});
