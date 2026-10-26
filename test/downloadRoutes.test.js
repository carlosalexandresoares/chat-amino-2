const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const downloads = require('../src/routes/downloadRoutes');
const androidRelease = require('../src/config/androidRelease.json');

test('downloads hospedados continuam disponíveis sem os arquivos de build locais', async t => {
  t.mock.method(fs, 'stat', async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
  let status;
  await downloads.status({}, {
    set(name, value) { assert.equal(name, 'Cache-Control'); assert.equal(value, 'no-store'); return this; },
    json(value) { status = value; },
  });
  assert.deepEqual(status, { android: true, windows: true, ios: false });

  for (const platform of ['android', 'windows']) {
    let redirect;
    await downloads.download({ params: { platform } }, {
      redirect(code, url) { redirect = { code, url }; },
    });
    assert.equal(redirect.code, 302);
    if (platform === 'android') assert.equal(redirect.url, androidRelease.downloadUrl);
    else assert.match(redirect.url, /^https:\/\/github\.com\/carlosalexandresoares\/chat-amino-2\/releases\/download\/v0\.1\.0-beta\.1\//);
  }
});

test('manifesto de atualização Android anuncia APK e hash verificável', () => {
  let result;
  downloads.androidUpdate({}, {
    set(name, value) { assert.equal(name, 'Cache-Control'); assert.equal(value, 'no-store'); return this; },
    json(value) { result = value; },
  });
  assert.equal(result.versionCode, androidRelease.versionCode);
  assert.equal(result.versionName, androidRelease.versionName);
  assert.equal(result.downloadUrl, androidRelease.downloadUrl);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
