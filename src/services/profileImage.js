const crypto = require('crypto');

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_BANNER_BYTES = 5 * 1024 * 1024;

function imageMime(data) {
  if (!Buffer.isBuffer(data)) return null;
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

function imageUrl(userId, kind) {
  return `/api/auth/media/${encodeURIComponent(userId)}/${kind}?v=${crypto.randomBytes(8).toString('hex')}`;
}

function validExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch { return false; }
}

module.exports = { imageMime, imageUrl, validExternalUrl, MAX_AVATAR_BYTES, MAX_BANNER_BYTES };
