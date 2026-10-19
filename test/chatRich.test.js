const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const chat = require('../src/services/chatMessages');
const media = require('../src/services/chatMedia');

const user = { id: 'u1', username: 'Naruto', avatar: null, level: 1, xp: 0 };
function row(extra = {}) { return { id: 'm1', roomId: 'geral', content: 'Olá!', type: 'TEXT', mediaId: null,
  media: null, replyToId: null, replyTo: null, reactions: [], deletedAt: null,
  user, createdAt: new Date('2026-10-19T10:00:00Z'), ...extra }; }

test('mensagens antigas permanecem texto e respostas preservam vínculo', () => {
  const formatted = chat.format(row({ replyToId: 'm0', replyTo: row({ id: 'm0', content: 'Mensagem anterior', user }) }));
  assert.equal(formatted.type, 'TEXT');
  assert.equal(formatted.replyTo.id, 'm0');
  assert.equal(formatted.replyTo.message, 'Mensagem anterior');
  assert.equal(formatted.user.level, 1);
});

test('resposta à mensagem excluída mostra conteúdo indisponível', () => {
  const formatted = chat.format(row({ replyToId: 'm0', replyTo: row({ id: 'm0', deletedAt: new Date() }) }));
  assert.equal(formatted.replyTo.message, 'Mensagem indisponível');
  assert.equal(chat.format(row({ deletedAt: new Date(), mediaId: 'secret' })).mediaId, null);
});

test('validação de áudio usa assinatura e duração real', async () => {
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  assert.equal(media.audioMime(wav), 'audio/wav');
  const valid = await media.prepareAudio(wav);
  assert.equal(Math.round(valid.duration), 1);
  await assert.rejects(media.prepareAudio(Buffer.from('<script>alert(1)</script>')));
  await assert.rejects(media.prepareAudio(Buffer.alloc(media.MAX_AUDIO_BYTES + 1)));
});

test('figurinha é recortada e convertida para WebP; SVG ativo é rejeitado', async () => {
  const png = await sharp({ create: { width: 400, height: 300, channels: 4, background: '#f55' } }).png().toBuffer();
  const result = await media.prepareImage(png, 'STICKER', { x: 25, y: 75 });
  const info = await sharp(result.buffer).metadata();
  assert.equal(info.format, 'webp');
  assert.equal(info.width, 256);
  assert.equal(info.height, 256);
  await assert.rejects(media.prepareImage(Buffer.from('<svg onload="alert(1)"></svg>'), 'STICKER'));
});
