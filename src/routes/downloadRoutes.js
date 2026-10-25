const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const packages = {
  android: {
    file: path.join(root, 'mobile/android/app/build/outputs/apk/debug/app-debug.apk'),
    name: 'Purp-Android-teste.apk',
    url: 'PURP_ANDROID_DOWNLOAD_URL',
  },
  windows: {
    file: path.join(root, 'desktop/dist/Purp Setup 0.1.0.exe'),
    name: 'Purp-Windows-Setup.exe',
    url: 'PURP_WINDOWS_DOWNLOAD_URL',
  },
};

function externalUrl(packageInfo) {
  const value = process.env[packageInfo.url];
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

async function available(packageInfo) {
  if (externalUrl(packageInfo)) return true;
  try { return (await fs.stat(packageInfo.file)).isFile(); }
  catch { return false; }
}

async function status(_req, res) {
  const [android, windows] = await Promise.all([
    available(packages.android), available(packages.windows),
  ]);
  res.set('Cache-Control', 'no-store').json({ android, windows, ios: false });
}

async function download(req, res) {
  const packageInfo = packages[req.params.platform];
  if (!packageInfo) return res.sendStatus(404);
  const url = externalUrl(packageInfo);
  if (url) return res.redirect(302, url);
  if (!(await available(packageInfo))) return res.sendStatus(404);
  return res.download(packageInfo.file, packageInfo.name);
}

module.exports = { status, download };
