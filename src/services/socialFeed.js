const prisma = require('../database/prisma');

function noBlock(userId) {
  return { blocksMade: { none: { blockedId: userId } }, blocksReceived: { none: { blockerId: userId } } };
}

function accessibleRoom(userId) {
  return { OR: [{ roomId: null }, { room: { is: { sanctions: { none: {
    userId, type: 'SUSPEND', revokedAt: null, expiresAt: { gt: new Date() },
  } } } } }] };
}

function visibleWhere(userId) {
  return {
    hiddenBy: { none: { userId } },
    user: noBlock(userId),
    AND: [accessibleRoom(userId), { OR: [{ sharedPostId: null }, { sharedPost: { is: {
      hiddenBy: { none: { userId } }, user: noBlock(userId), ...accessibleRoom(userId),
    } } }] }],
  };
}

const publicSelect = userId => ({
  id: true, userId: true, roomId: true, sharedPostId: true, content: true, createdAt: true, featuredAt: true,
  user: { select: { id: true, username: true, avatar: true, level: true } },
  room: { select: { id: true, name: true, topic: true } },
  sharedPost: { select: { id: true, content: true, createdAt: true,
    user: { select: { id: true, username: true, avatar: true } } } },
  likes: { where: { userId }, select: { userId: true } },
  saves: { where: { userId }, select: { userId: true } },
  _count: { select: { likes: true, comments: true, shares: true } },
});

function serialize(post) {
  return { ...post, liked: Boolean(post.likes?.length), saved: Boolean(post.saves?.length),
    likes: undefined, saves: undefined,
    likesCount: post._count.likes, commentsCount: post._count.comments,
    sharesCount: post._count.shares, _count: undefined };
}

function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw, mode) {
  if (!raw) return { snapshot: new Date().toISOString(), bucket: 1 };
  if (typeof raw !== 'string' || raw.length > 500) throw new Error('Cursor inválido.');
  try {
    const cursor = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (cursor.mode !== mode || !Number.isFinite(Date.parse(cursor.snapshot)) ||
      !Number.isFinite(Date.parse(cursor.date)) || typeof cursor.id !== 'string' || cursor.id.length > 100 ||
      ![0, 1].includes(cursor.bucket)) throw new Error();
    return cursor;
  } catch { throw new Error('Cursor inválido.'); }
}

function older(cursor) {
  if (!cursor.date) return {};
  return { OR: [
    { createdAt: { lt: new Date(cursor.date) } },
    { createdAt: new Date(cursor.date), id: { lt: cursor.id } },
  ] };
}

async function feed(userId, mode, rawCursor) {
  if (!['following', 'forYou', 'saved'].includes(mode)) throw new Error('Feed inválido.');
  const cursor = decodeCursor(rawCursor, mode);
  const snapshot = new Date(cursor.snapshot);
  const base = visibleWhere(userId);
  const limit = 15;
  if (mode === 'saved') {
    const saved = await prisma.savedPost.findMany({ where: { userId, createdAt: { lte: snapshot },
      ...(cursor.date ? { OR: [ { createdAt: { lt: new Date(cursor.date) } },
        { createdAt: new Date(cursor.date), postId: { lt: cursor.id } } ] } : {}),
      post: base }, orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }], take: limit + 1,
      select: { postId: true, createdAt: true, post: { select: publicSelect(userId) } } });
    const page = saved.slice(0, limit);
    return { posts: page.map(item => serialize(item.post)), nextCursor: saved.length > limit ?
      encodeCursor({ mode, snapshot: cursor.snapshot, bucket: 1,
        date: page.at(-1).createdAt.toISOString(), id: page.at(-1).postId }) : null };
  }
  const followed = { OR: [
    { userId },
    { user: { followers: { some: { followerId: userId } } } },
    { room: { is: { members: { some: { userId } } } } },
    { room: { is: { favorites: { some: { userId } } } } },
  ] };
  const interests = await prisma.communityInterest.findMany({ where: { userId }, select: { topic: true } });
  const recommended = { OR: [
    ...followed.OR,
    { featuredAt: { not: null } },
    { likes: { some: {} } },
    ...(interests.length ? [{ room: { is: { topic: { in: interests.map(item => item.topic) } } } }] : []),
  ] };
  const common = { AND: [base, { createdAt: { lte: snapshot } }] };
  const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
  if (mode === 'following') {
    const posts = await prisma.post.findMany({ where: { AND: [common, followed, older(cursor)] },
      orderBy, take: limit + 1, select: publicSelect(userId) });
    const page = posts.slice(0, limit);
    return { posts: page.map(serialize), nextCursor: posts.length > limit ?
      encodeCursor({ mode, snapshot: cursor.snapshot, bucket: 1,
        date: page.at(-1).createdAt.toISOString(), id: page.at(-1).id }) : null };
  }
  // Recommendations are a stable first bucket. The second bucket offers recent discovery.
  const first = cursor.bucket === 1 ? await prisma.post.findMany({
    where: { AND: [common, recommended, older(cursor)] }, orderBy, take: limit + 1,
    select: publicSelect(userId),
  }) : [];
  const page = first.slice(0, limit);
  if (page.length === limit && first.length > limit) return { posts: page.map(serialize), nextCursor:
    encodeCursor({ mode, snapshot: cursor.snapshot, bucket: 1,
      date: page.at(-1).createdAt.toISOString(), id: page.at(-1).id }) };
  if (page.length === limit) return { posts: page.map(serialize), nextCursor:
    encodeCursor({ mode, snapshot: cursor.snapshot, bucket: 0,
      date: snapshot.toISOString(), id: '~' }) };
  const remaining = limit - page.length;
  const fresh = await prisma.post.findMany({ where: { AND: [common, { NOT: recommended },
    cursor.bucket === 0 ? older(cursor) : {}] }, orderBy, take: remaining + 1,
    select: publicSelect(userId) });
  const recent = fresh.slice(0, remaining);
  page.push(...recent);
  return { posts: page.map(serialize), nextCursor: fresh.length > remaining ?
    encodeCursor({ mode, snapshot: cursor.snapshot, bucket: 0,
      date: recent.at(-1).createdAt.toISOString(), id: recent.at(-1).id }) : null };
}

async function visiblePost(userId, postId) {
  return prisma.post.findFirst({ where: { id: postId, ...visibleWhere(userId) },
    select: { id: true, userId: true, roomId: true, sharedPostId: true, content: true } });
}

module.exports = { noBlock, visibleWhere, visiblePost, publicSelect, serialize, feed };
