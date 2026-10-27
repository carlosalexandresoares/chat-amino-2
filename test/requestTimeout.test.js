const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('requisições presas são canceladas mesmo sem AbortSignal.timeout', async () => {
  const source = await fs.readFile(path.join(__dirname, '../public/script/request-timeout.js'), 'utf8');
  const { fetchWithTimeout } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const originalFetch = global.fetch;
  const originalTimeout = AbortSignal.timeout;
  try {
    AbortSignal.timeout = undefined;
    global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelado'), { name: 'AbortError' })));
    });
    await assert.rejects(fetchWithTimeout('/api/stuck', {}, 15), { name: 'TimeoutError' });
  } finally {
    AbortSignal.timeout = originalTimeout;
    global.fetch = originalFetch;
  }
});
