require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const cloudinary = require('../config/cloudinary');
const media = require('../src/services/chatMedia');

test('Cloudinary armazena áudio e figurinha privados e permite remoção', {
  skip: process.env.RUN_CLOUDINARY_TESTS !== '1' && 'Defina RUN_CLOUDINARY_TESTS=1 para testar o Cloudinary',
  timeout: 120000,
}, async () => {
  const stored = [];
  try {
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    const audio = await media.put('AUDIO', 'cloud-test', null, await media.prepareAudio(wav));
    stored.push(audio.key);
    assert.deepEqual(await media.get(audio.key), wav);

    const png = await sharp({ create: { width: 40, height: 50, channels: 4, background: '#3355aa' } }).png().toBuffer();
    const image = await media.prepareImage(png, 'STICKER');
    const sticker = await media.put('STICKER', 'cloud-test', null, image);
    stored.push(sticker.key);
    assert.deepEqual(await media.get(sticker.key), image.buffer);

    const publicId = sticker.key.split(':').slice(3).join(':');
    const unsigned = cloudinary.url(publicId, { resource_type: 'image', type: 'authenticated', format: 'webp', secure: true });
    assert.notEqual((await fetch(unsigned)).status, 200);
  } finally {
    for (const key of stored) await media.remove(key);
  }
});
