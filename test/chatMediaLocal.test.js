const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config();

test('arquivos locais persistem, são lidos e removidos fora da pasta pública', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-media-test-'));
  const previous = process.env.CHAT_STORAGE_DIR;
  const cloudinaryVariables = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const previousCloudinary = cloudinaryVariables.map(name => process.env[name]);
  for (const name of cloudinaryVariables) process.env[name] = '';
  process.env.CHAT_STORAGE_DIR = root;
  delete require.cache[require.resolve('../src/services/chatMedia')];
  const media = require('../src/services/chatMedia');
  try {
    assert.equal(media.configured, true);
    const content = Buffer.from('arquivo de teste');
    const asset = await media.put('STICKER', 'user-1', null,
      { buffer: content, mimeType: 'image/webp', extension: 'webp' });
    assert.deepEqual(await media.get(asset.key), content);
    await assert.rejects(media.get('../.env'), /Arquivo inválido/);
    await media.remove(asset.key);
    await assert.rejects(media.get(asset.key), { code: 'ENOENT' });
  } finally {
    if (previous === undefined) delete process.env.CHAT_STORAGE_DIR;
    else process.env.CHAT_STORAGE_DIR = previous;
    cloudinaryVariables.forEach((name, index) => {
      if (previousCloudinary[index] === undefined) delete process.env[name];
      else process.env[name] = previousCloudinary[index];
    });
    delete require.cache[require.resolve('../src/services/chatMedia')];
    await fs.rm(root, { recursive: true, force: true });
  }
});
