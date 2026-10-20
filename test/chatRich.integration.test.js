require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const prisma = require('../src/database/prisma');
const chatRoutes = require('../src/routes/chatRoutes');
const media = require('../src/services/chatMedia');

test('histórico, respostas, autorização, exclusão, reações e wallpaper persistem', {
  skip: process.env.RUN_CHAT_DB_TESTS !== '1' && 'Defina RUN_CHAT_DB_TESTS=1 para testar no PostgreSQL',
  timeout: 120000,
}, async () => {
  const tag = randomUUID();
  const createUser = role => prisma.user.create({ data: {
    username: `chat-${role}-${tag}`, email: `chat-${role}-${tag}@test.invalid`, password: 'test',
  } });
  const owner = await createUser('owner');
  let viewer, outsider, room, secondRoom, server, storedAssetKey, sourceStickerKey, savedStickerKey;
  try {
    viewer = await createUser('viewer'); outsider = await createUser('outsider');
    room = await prisma.room.create({ data: { name: 'Sala de teste', ownerId: owner.id,
      members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: viewer.id, role: 'MEMBER' }] } } });
    secondRoom = await prisma.room.create({ data: { name: 'Outra sala de teste', ownerId: owner.id,
      members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: viewer.id, role: 'MEMBER' }] } } });
    const original = await prisma.message.create({ data: { roomId: room.id, userId: owner.id, content: 'Mensagem original' } });
    const reply = await prisma.message.create({ data: { roomId: room.id, userId: viewer.id, content: 'Estou chegando', replyToId: original.id } });
    const audio = await prisma.chatAsset.create({ data: { key: `test/${tag}/audio`, kind: 'AUDIO', mimeType: 'audio/wav', size: 100,
      duration: 1, ownerId: owner.id, roomId: room.id } });
    await prisma.message.create({ data: { roomId: room.id, userId: owner.id, type: 'AUDIO', mediaId: audio.id } });
    const stickerAsset = await prisma.chatAsset.create({ data: { key: `test/${tag}/sticker`, kind: 'STICKER',
      mimeType: 'image/webp', size: 100, ownerId: owner.id } });
    const sticker = await prisma.sticker.create({ data: { name: 'Teste', ownerId: owner.id, assetId: stickerAsset.id } });
    const app = express(); app.use(express.json()); app.use('/api/chat', chatRoutes);
    app.set('io', { to: () => ({ emit() {} }) });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}/api/chat`;
    const call = (user, path, options = {}) => fetch(base + path, { ...options,
      headers: { Authorization: `Bearer ${jwt.sign({ sub: user.id }, process.env.JWT_SECRET)}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });

    const history = await call(viewer, `/rooms/${room.id}/messages`);
    assert.equal(history.status, 200);
    const rows = (await history.json()).messages;
    assert.equal(rows.length, 3);
    assert.equal(rows.find(row => row.id === reply.id).replyTo.message, 'Mensagem original');
    assert.equal(rows.find(row => row.mediaId === audio.id).type, 'AUDIO');
    assert.equal((await call(outsider, `/rooms/${room.id}/messages`)).status, 403);
    assert.equal((await call(outsider, `/messages/${original.id}/context`)).status, 404);
    assert.equal((await call(outsider, `/media/${audio.id}`)).status, 403);
    assert.equal((await call(outsider, '/stickers')).status, 200);
    assert.equal((await (await call(viewer, '/stickers')).json()).stickers.length, 0);
    assert.equal((await (await call(owner, '/stickers')).json()).stickers[0].id, sticker.id);
    assert.equal((await call(viewer, `/stickers/${sticker.id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite: true }) })).status, 404);
    assert.equal((await call(viewer, `/stickers/${sticker.id}`, { method: 'DELETE' })).status, 404);
    const upload = new FormData(); upload.append('roomId', room.id);
    upload.append('file', new Blob(['not audio'], { type: 'audio/wav' }), 'invalid.wav');
    const badUpload = await fetch(base + '/audio', { method: 'POST',
      headers: { Authorization: `Bearer ${jwt.sign({ sub: viewer.id }, process.env.JWT_SECRET)}` }, body: upload });
    assert.equal(badUpload.status, 400);
    assert.equal((await call(viewer, `/messages/${original.id}/reaction`, { method: 'PUT', body: JSON.stringify({ emoji: '🔥' }) })).status, 200);
    assert.equal((await call(outsider, `/messages/${original.id}/reaction`, { method: 'PUT', body: JSON.stringify({ emoji: '👍' }) })).status, 403);
    assert.equal((await call(viewer, `/messages/${original.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await call(owner, `/messages/${original.id}`, { method: 'DELETE' })).status, 200);
    const afterDelete = await call(viewer, `/rooms/${room.id}/messages`);
    assert.equal((await afterDelete.json()).messages.find(row => row.id === reply.id).replyTo.message, 'Mensagem indisponível');
    const appearance = { roomId: room.id, mode: 'COLOR', color: '#123456', positionX: 50, positionY: 50, darkness: 0, overlay: 0 };
    assert.equal((await call(viewer, '/appearance', { method: 'PUT', body: JSON.stringify(appearance) })).status, 200);
    assert.equal((await (await call(viewer, `/appearance?roomId=${room.id}`)).json()).appearance.color, '#123456');
    assert.equal((await (await call(viewer, `/appearance?roomId=${secondRoom.id}`)).json()).appearance, null);
    assert.equal((await (await call(outsider, `/appearance?roomId=${room.id}`)).json()).appearance, null);
    assert.equal((await call(viewer, '/appearance')).status, 400);
    assert.equal((await call(viewer, '/appearance', { method: 'PUT', body: JSON.stringify({ ...appearance, roomId: secondRoom.id, color: '#654321' }) })).status, 200);
    assert.equal((await (await call(viewer, `/appearance?roomId=${room.id}`)).json()).appearance.color, '#123456');
    assert.equal((await (await call(viewer, `/appearance?roomId=${secondRoom.id}`)).json()).appearance.color, '#654321');
    if (media.configured) {
      const image = await sharp({ create: { width: 100, height: 80, channels: 4, background: '#6655aa' } }).png().toBuffer();
      const prepared = await media.prepareImage(image, 'STICKER');
      const sourceStored = await media.put('STICKER', owner.id, null, prepared);
      sourceStickerKey = sourceStored.key;
      const sourceAsset = await prisma.chatAsset.create({ data: sourceStored });
      const sourceSticker = await prisma.sticker.create({ data: { name: 'Figurinha privada', ownerId: owner.id, assetId: sourceAsset.id } });
      const stickerMessage = await prisma.message.create({ data: { roomId: room.id, userId: owner.id, type: 'STICKER', mediaId: sourceAsset.id } });
      assert.equal((await call(outsider, `/media/${sourceAsset.id}`)).status, 403);
      assert.equal((await call(viewer, `/media/${sourceAsset.id}`)).status, 200);
      assert.equal((await call(outsider, '/stickers/save', { method: 'POST', body: JSON.stringify({ messageId: stickerMessage.id }) })).status, 404);
      const savedResponse = await call(viewer, '/stickers/save', { method: 'POST', body: JSON.stringify({ messageId: stickerMessage.id }) });
      assert.equal(savedResponse.status, 201);
      const { sticker: savedSticker } = await savedResponse.json();
      const savedRecord = await prisma.sticker.findUniqueOrThrow({ where: { id: savedSticker.id }, include: { asset: true } });
      savedStickerKey = savedRecord.asset.key;
      assert.notEqual(savedRecord.assetId, sourceAsset.id);
      assert.notEqual(savedRecord.asset.key, sourceStored.key);
      assert.equal(savedRecord.ownerId, viewer.id);
      assert.equal((await call(viewer, '/stickers/save', { method: 'POST', body: JSON.stringify({ messageId: stickerMessage.id }) })).status, 200);
      assert.equal((await (await call(viewer, '/stickers')).json()).stickers.length, 1);
      assert.equal((await (await call(viewer, '/stickers?tab=mine')).json()).stickers.length, 0);
      assert.equal((await call(viewer, `/stickers/${savedSticker.id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite: true }) })).status, 200);
      assert.equal((await (await call(viewer, '/stickers?tab=favorites')).json()).stickers[0].id, savedSticker.id);
      assert.equal((await call(owner, `/stickers/${sourceSticker.id}`, { method: 'DELETE' })).status, 200);
      assert.equal((await call(viewer, `/media/${savedRecord.assetId}`)).status, 200);
      assert.equal((await call(viewer, `/stickers/${savedSticker.id}`, { method: 'DELETE' })).status, 200);
      assert.equal((await (await call(viewer, '/stickers')).json()).stickers.length, 0);
      assert.equal((await call(viewer, `/media/${sourceAsset.id}`)).status, 200);
      const form = new FormData();
      form.append('file', new Blob([image], { type: 'image/png' }), 'wallpaper.png');
      const uploaded = await fetch(base + '/wallpaper', { method: 'POST',
        headers: { Authorization: `Bearer ${jwt.sign({ sub: viewer.id }, process.env.JWT_SECRET)}` }, body: form });
      assert.equal(uploaded.status, 201);
      const { id } = await uploaded.json();
      const asset = await prisma.chatAsset.findUniqueOrThrow({ where: { id } });
      storedAssetKey = asset.key;
      assert.equal((await call(viewer, `/media/${id}`)).status, 200);
      assert.equal((await call(outsider, `/media/${id}`)).status, 403);
    }
    await prisma.roomMember.delete({ where: { userId_roomId: { userId: viewer.id, roomId: room.id } } });
    assert.equal((await call(viewer, `/media/${audio.id}`)).status, 403);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (storedAssetKey) await media.remove(storedAssetKey);
    if (sourceStickerKey) await media.remove(sourceStickerKey);
    if (savedStickerKey) await media.remove(savedStickerKey);
    if (room) await prisma.room.delete({ where: { id: room.id } });
    if (secondRoom) await prisma.room.delete({ where: { id: secondRoom.id } });
    if (viewer) await prisma.user.delete({ where: { id: viewer.id } });
    if (outsider) await prisma.user.delete({ where: { id: outsider.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }
});
