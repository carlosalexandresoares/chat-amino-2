const test = require('node:test');
const assert = require('node:assert/strict');
const { imageMime, validExternalUrl, MAX_AVATAR_BYTES, MAX_BANNER_BYTES } = require('../src/services/profileImage');

test('detecta imagens pelo conteúdo e rejeita arquivos disfarçados', () => {
  assert.equal(imageMime(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64')), 'image/png');
  assert.equal(imageMime(Buffer.from([255, 216, 255, 224])), 'image/jpeg');
  assert.equal(imageMime(Buffer.from('GIF89a', 'ascii')), 'image/gif');
  assert.equal(imageMime(Buffer.from('<svg onload="alert(1)">')), null);
  assert.equal(imageMime(Buffer.from('not an image')), null);
});

test('aceita apenas links HTTP(S) e limita os tamanhos', () => {
  assert.equal(validExternalUrl('https://example.com/avatar.jpg'), true);
  assert.equal(validExternalUrl('http://example.com/banner.png'), true);
  assert.equal(validExternalUrl('javascript:alert(1)'), false);
  assert.equal(validExternalUrl('data:image/svg+xml;base64,AA=='), false);
  assert.equal(MAX_AVATAR_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_BANNER_BYTES, 5 * 1024 * 1024);
});
