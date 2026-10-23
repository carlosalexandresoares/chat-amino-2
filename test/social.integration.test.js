require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../src/database/prisma');

test('feed social: acesso, paginação, comentários, compartilhamento, salvos e denúncias', {
  skip: process.env.RUN_SOCIAL_LIVE_TESTS !== '1' && 'Defina RUN_SOCIAL_LIVE_TESTS=1 com servidor local e banco migrado',
  timeout: 180000,
}, async () => {
  const base = process.env.SOCIAL_LIVE_URL || 'http://localhost:3000';
  const tag = randomUUID();
  const users = [];
  let roomId;
  let otherRoomId;
  const token = user => jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
  const call = (user, route, method = 'GET', body) => fetch(`${base}${route}`, { method,
    headers: { Authorization: `Bearer ${token(user)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = async response => { const data = await response.json();
    assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`); return data; };
  try {
    for (const role of ['author', 'reader', 'stranger']) users.push(await prisma.user.create({ data: {
      username: `social-${role}-${tag}`, email: `social-${role}-${tag}@test.invalid`, password: 'test',
    } }));
    const [author, reader, stranger] = users;
    const room = await json(await call(author, '/api/rooms', 'POST', { name: `Social ${tag.slice(0, 8)}`, topic: 'ANIME' }));
    roomId = room.room.id;
    await prisma.roomMember.create({ data: { userId: reader.id, roomId } });
    assert.equal((await call(stranger, '/api/posts', 'POST', { content: 'Não permitido', roomId })).status, 403);
    assert.equal((await call(reader, `/api/users/${author.id}/follow`, 'POST')).status, 200);
    assert.equal((await call(reader, '/api/community/interests', 'PUT', { topics: ['ANIME'] })).status, 200);
    const first = await json(await call(author, '/api/posts', 'POST', { content: 'Post de anime', roomId }));
    const second = await json(await call(stranger, '/api/posts', 'POST', { content: 'Post de fora' }));
    const firstId = first.post.id;
    const secondId = second.post.id;
    const following = await json(await call(reader, '/api/social/feed?mode=following'));
    assert.ok(following.posts.some(post => post.id === firstId));
    assert.ok(!following.posts.some(post => post.id === secondId));
    const forYou = await json(await call(reader, '/api/social/feed?mode=forYou'));
    assert.equal(forYou.posts[0].id, firstId);
    assert.ok(forYou.posts.some(post => post.id === secondId));
    assert.equal((await call(reader, '/api/social/posts/bad/comments')).status, 404);
    const comment = await json(await call(reader, `/api/social/posts/${firstId}/comments`, 'POST', { content: 'Gostei muito!' }));
    assert.equal((await call(stranger, `/api/social/comments/${comment.comment.id}`, 'DELETE')).status, 403);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/comments`, 'POST', { content: 'Incorreto', parentId: 'bad' })).status, 400);
    const reply = await json(await call(author, `/api/social/posts/${firstId}/comments`, 'POST', {
      content: 'Obrigado!', parentId: comment.comment.id }));
    assert.equal(reply.comment.parentId, comment.comment.id);
    const comments = await json(await call(reader, `/api/social/posts/${firstId}/comments`));
    assert.deepEqual(comments.comments.map(item => item.id), [reply.comment.id, comment.comment.id]);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/save`, 'PUT')).status, 200);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/save`, 'PUT')).status, 200);
    assert.equal((await prisma.savedPost.count({ where: { postId: firstId, userId: reader.id } })), 1);
    const saved = await json(await call(reader, '/api/social/feed?mode=saved'));
    assert.equal(saved.posts[0].id, firstId);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/share`, 'POST', { content: 'Compartilhando' })).status, 201);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/share`, 'POST', {})).status, 409);
    const shared = await prisma.post.findFirst({ where: { userId: reader.id, sharedPostId: firstId } });
    assert.ok(shared);
    assert.equal((await call(stranger, `/api/social/posts/${shared.id}/share`, 'POST')).status, 400);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/report`, 'POST', { reason: 'SPAM' })).status, 201);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/report`, 'POST', { reason: 'SPAM' })).status, 409);
    assert.equal((await call(author, `/api/social/posts/${firstId}/report`, 'POST', { reason: 'SPAM' })).status, 400);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/hide`, 'PUT')).status, 200);
    assert.ok(!(await json(await call(reader, '/api/social/feed?mode=forYou'))).posts.some(post => post.id === firstId));
    assert.equal((await call(reader, `/api/social/posts/${firstId}`)).status, 404);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/comments`)).status, 404);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/save`, 'PUT')).status, 404);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/hide`, 'DELETE')).status, 200);
    assert.equal((await call(reader, `/api/social/posts/${firstId}`)).status, 200);
    assert.equal((await call(reader, '/api/direct/blocks/' + author.id, 'PUT')).status, 200);
    assert.equal((await call(reader, `/api/social/posts/${firstId}`)).status, 404);
    assert.equal((await call(reader, `/api/posts/${firstId}/like`, 'POST')).status, 404);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/comments`, 'POST', { content: 'bloqueado' })).status, 404);
    assert.equal((await call(reader, '/api/direct/blocks/' + author.id, 'DELETE')).status, 200);
    assert.equal((await call(reader, `/api/social/comments/${comment.comment.id}`, 'DELETE')).status, 200);
    assert.equal((await prisma.postComment.count({ where: { postId: firstId } })), 0);
    assert.equal((await call(reader, `/api/social/posts/${firstId}/save`, 'DELETE')).status, 200);
    assert.ok(!(await json(await call(reader, '/api/social/feed?mode=saved'))).posts.some(post => post.id === firstId));
    // Cursor includes a fixed snapshot and must not duplicate posts across pages.
    for (let i = 0; i < 18; i++) await prisma.post.create({ data: { userId: author.id, content: `Página ${i}`, roomId } });
    const page1 = await json(await call(reader, '/api/social/feed?mode=following'));
    assert.equal(page1.posts.length, 15); assert.ok(page1.nextCursor);
    const page2 = await json(await call(reader, `/api/social/feed?mode=following&cursor=${encodeURIComponent(page1.nextCursor)}`));
    assert.ok(page2.posts.length > 0);
    assert.equal(new Set([...page1.posts, ...page2.posts].map(post => post.id)).size, page1.posts.length + page2.posts.length);
    const forYouPage1 = await json(await call(reader, '/api/social/feed?mode=forYou'));
    const forYouPage2 = await json(await call(reader, `/api/social/feed?mode=forYou&cursor=${encodeURIComponent(forYouPage1.nextCursor)}`));
    assert.equal(new Set([...forYouPage1.posts, ...forYouPage2.posts].map(post => post.id)).size,
      forYouPage1.posts.length + forYouPage2.posts.length);
    await prisma.postComment.createMany({ data: Array.from({ length: 31 }, (_, i) => ({
      id: `social-comment-${tag}-${i}`, postId: firstId, userId: author.id, content: `Comentário ${i}`,
      createdAt: new Date(Date.now() + i * 1000),
    })) });
    const commentsPage1 = await json(await call(reader, `/api/social/posts/${firstId}/comments`));
    assert.equal(commentsPage1.comments.length, 30); assert.ok(commentsPage1.nextCursor);
    const commentsPage2 = await json(await call(reader, `/api/social/posts/${firstId}/comments?cursor=${encodeURIComponent(commentsPage1.nextCursor)}`));
    assert.equal(commentsPage2.comments.length, 1);
    assert.notEqual(commentsPage2.comments[0].id, commentsPage1.comments.at(-1).id);
    assert.equal((await call(reader, '/api/social/feed?mode=following&cursor=invalid')).status, 400);
    const otherRoom = await json(await call(stranger, '/api/rooms', 'POST', {
      name: `Outro social ${tag.slice(0, 8)}`, topic: 'ANIME' }));
    otherRoomId = otherRoom.room.id;
    const otherPost = await json(await call(stranger, '/api/posts', 'POST', {
      content: 'Post de outra comunidade', roomId: otherRoomId }));
    assert.equal((await call(author, `/api/posts/${otherPost.post.id}/feature`, 'POST')).status, 403);
    assert.equal((await call(author, `/api/posts/${secondId}/feature`, 'POST')).status, 403);
    assert.equal((await call(author, `/api/posts/${firstId}/feature`, 'POST')).status, 200);
  } finally {
    if (users.length) await prisma.moderationReport.deleteMany({
      where: { reporterId: { in: users.map(user => user.id) } },
    });
    if (otherRoomId) await prisma.room.deleteMany({ where: { id: otherRoomId } });
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    for (const user of users.reverse()) await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
