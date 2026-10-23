require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../src/database/prisma');
const routes = require('../src/routes/directRoutes');
const sharp = require('sharp');
const media = require('../src/services/chatMedia');

test('DMs persistem e recusam terceiros, solicitações e interações bloqueadas', {
  skip: process.env.RUN_DIRECT_DB_TESTS !== '1' && 'Defina RUN_DIRECT_DB_TESTS=1 com PostgreSQL de teste migrado',
  timeout: 120000,
}, async () => {
  const tag = randomUUID();
  const users = [];
  let server;
  try {
    for (const name of ['ana', 'bia', 'terceiro']) users.push(await prisma.user.create({ data: {
      username: `direct-${name}-${tag}`, email: `direct-${name}-${tag}@test.invalid`, password: 'test',
    } }));
    const [ana, bia, outsider] = users;
    const app = express(); app.use(express.json()); app.use('/api/direct', routes);
    const io = { to() { return this; }, emit() {}, sockets: { adapter: { rooms: new Map() }, sockets: new Map() } };
    app.set('io', io); app.set('refreshPresence', () => {});
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}/api/direct`;
    const call = (user, path, options = {}) => fetch(base + path, { ...options, headers: {
      Authorization: `Bearer ${jwt.sign({ sub: user.id }, process.env.JWT_SECRET)}`,
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    } });

    const started = await call(ana, '/conversations', { method: 'POST', body: JSON.stringify({ userId: bia.id }) });
    assert.equal(started.status, 201);
    const conversation = (await started.json()).conversation;
    assert.equal(conversation.status, 'PENDING');
    assert.equal((await call(outsider, `/conversations/${conversation.id}/messages`)).status, 404);
    assert.equal((await call(bia, `/conversations/${conversation.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'Olá' }) })).status, 403);
    const sent = await call(ana, `/conversations/${conversation.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'Oi Bia' }) });
    assert.equal(sent.status, 201);
    const message = (await sent.json()).message;
    assert.equal((await call(outsider, `/messages/${message.id}`, { method: 'DELETE' })).status, 403);
    const inbox = await call(bia, '/conversations');
    assert.equal((await inbox.json()).conversations[0].incomingRequest, true);
    assert.equal((await call(bia, `/conversations/${conversation.id}/request`, { method: 'PATCH', body: JSON.stringify({ action: 'accept' }) })).status, 200);
    assert.equal((await call(ana, `/conversations/${conversation.id}/request`, { method: 'PATCH', body: JSON.stringify({ action: 'decline' }) })).status, 403);
    const history = await call(bia, `/conversations/${conversation.id}/messages`);
    assert.equal((await history.json()).messages[0].content, 'Oi Bia');
    const reread = await call(ana, `/conversations/${conversation.id}/messages`);
    assert.ok((await reread.json()).messages[0].readAt);
    if (media.configured) {
      const png = await sharp({ create: { width: 16, height: 16, channels: 4,
        background: { r: 80, g: 30, b: 160, alpha: 1 } } }).png().toBuffer();
      const imageForm = new FormData();
      imageForm.set('type', 'IMAGE');
      imageForm.set('file', new Blob([png], { type: 'image/png' }), 'photo.png');
      const uploadedImage = await call(ana, `/conversations/${conversation.id}/media`, { method: 'POST', body: imageForm });
      assert.equal(uploadedImage.status, 201);
      const imageId = (await uploadedImage.json()).asset.id;
      assert.equal((await call(ana, `/conversations/${conversation.id}/messages`, { method: 'POST',
        body: JSON.stringify({ type: 'IMAGE', mediaId: imageId }) })).status, 201);
      const downloadedImage = await call(bia, `/media/${imageId}`);
      assert.equal(downloadedImage.status, 200);
      assert.equal(downloadedImage.headers.get('content-type'), 'image/webp');
      assert.ok((await downloadedImage.arrayBuffer()).byteLength > 0);
      assert.equal((await call(outsider, `/media/${imageId}`)).status, 403);

      const wav = Buffer.alloc(44 + 16000);
      wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
      wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
      const audioForm = new FormData();
      audioForm.set('type', 'AUDIO');
      audioForm.set('file', new Blob([wav], { type: 'audio/wav' }), 'voice.wav');
      const uploadedAudio = await call(bia, `/conversations/${conversation.id}/media`, { method: 'POST', body: audioForm });
      assert.equal(uploadedAudio.status, 201);
      const audioId = (await uploadedAudio.json()).asset.id;
      assert.equal((await call(bia, `/conversations/${conversation.id}/messages`, { method: 'POST',
        body: JSON.stringify({ type: 'AUDIO', mediaId: audioId }) })).status, 201);
      const downloadedAudio = await call(ana, `/media/${audioId}`);
      assert.equal(downloadedAudio.status, 200);
      assert.equal(downloadedAudio.headers.get('content-type'), 'audio/wav');
      assert.equal((await downloadedAudio.arrayBuffer()).byteLength, wav.length);
    }
    const asset = await prisma.chatAsset.create({ data: { key: `direct-test/${tag}`, kind: 'DIRECT_IMAGE',
      mimeType: 'image/webp', size: 16, ownerId: ana.id } });
    assert.equal((await call(ana, `/conversations/${conversation.id}/messages`, { method: 'POST',
      body: JSON.stringify({ type: 'IMAGE', mediaId: asset.id }) })).status, 201);
    assert.equal((await call(outsider, `/media/${asset.id}`)).status, 403);
    assert.equal((await call(outsider, `/messages/${message.id}/reaction`, { method: 'PUT', body: JSON.stringify({ emoji: '👍' }) })).status, 403);
    assert.equal((await call(bia, `/conversations/${conversation.id}/report`, { method: 'POST', body: JSON.stringify({ reason: 'SPAM' }) })).status, 201);
    assert.equal((await call(bia, `/conversations/${conversation.id}/report`, { method: 'POST', body: JSON.stringify({ reason: 'SPAM' }) })).status, 409);
    assert.equal((await call(bia, `/blocks/${ana.id}`, { method: 'PUT' })).status, 200);
    assert.equal((await call(ana, `/conversations/${conversation.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'Bloqueado' }) })).status, 403);
    assert.equal((await call(ana, `/conversations/${conversation.id}/messages`)).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const ids = users.map(user => user.id);
    if (ids.length) {
      const assets = await prisma.chatAsset.findMany({ where: { ownerId: { in: ids } }, select: { key: true } });
      for (const asset of assets) if (asset.key !== `direct-test/${tag}`) await media.remove(asset.key);
      await prisma.moderationReport.deleteMany({ where: { reporterId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  }
});
