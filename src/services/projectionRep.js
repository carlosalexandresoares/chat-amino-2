const prisma = require('../database/prisma');
const reputation = require('./reputation');

const HOST_DAILY_LIMIT = 250;
const HOST_COLLECT_LIMIT = 25;
const VIEWER_LIVE_LIMIT = 30;
const VIEWER_DAILY_LIMIT = 100;
const ENGAGEMENT_MS = 10 * 60 * 1000;

function distinctViewerIds(sockets, roomId, hostId) {
  const ids = new Set();
  for (const socket of sockets.values()) {
    if (socket.rooms.has(roomId) && socket.user?.id && socket.user.id !== hostId) ids.add(socket.user.id);
  }
  return [...ids];
}

function hostAccrual(seconds, carriedSeconds, accruedToday) {
  const total = Math.max(0, seconds) + carriedSeconds;
  return { earned: Math.min(Math.floor(total / 60), Math.max(0, HOST_DAILY_LIMIT - accruedToday)),
    carriedSeconds: total % 60 };
}

function viewerAccrual(seconds, carriedSeconds, earnedLive, earnedToday) {
  const total = Math.max(0, seconds) + carriedSeconds;
  return { earned: Math.min(Math.floor(total / 300), Math.max(0, VIEWER_LIVE_LIMIT - earnedLive),
    Math.max(0, VIEWER_DAILY_LIMIT - earnedToday)), carriedSeconds: total % 300 };
}
function collectionAmount(pending, collectedToday, status) {
  if (status === 'ACTIVE' && pending < HOST_COLLECT_LIMIT) return 0;
  return Math.min(Math.max(0, pending), Math.max(0, HOST_DAILY_LIMIT - collectedToday),
    status === 'ACTIVE' ? HOST_COLLECT_LIMIT : Number.MAX_SAFE_INTEGER);
}

async function recordJoin(liveId, userId, simultaneous, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${liveId} FOR UPDATE`;
    const live = await tx.liveSession.findUnique({ where: { id: liveId }, select: { status: true, hostId: true, peakParticipants: true } });
    if (!live || live.status !== 'ACTIVE' || live.hostId === userId) return;
    await tx.projectionParticipant.upsert({ where: { liveId_userId: { liveId, userId } },
      create: { liveId, userId, joinedAt: now }, update: { lastLeftAt: null } });
    const openVisit = await tx.projectionVisit.findFirst({ where: { liveId, userId, leftAt: null }, select: { id: true } });
    if (!openVisit) await tx.projectionVisit.create({ data: { liveId, userId, enteredAt: now } });
    const uniqueVisitors = await tx.projectionParticipant.count({ where: { liveId } });
    await tx.liveSession.update({ where: { id: liveId }, data: {
      uniqueVisitors, peakParticipants: Math.max(live.peakParticipants, simultaneous),
    } });
  });
}

async function recordLeave(liveId, userId, now = new Date()) {
  await prisma.$transaction([
    prisma.projectionVisit.updateMany({ where: { liveId, userId, leftAt: null }, data: { leftAt: now } }),
    prisma.projectionParticipant.updateMany({ where: { liveId, userId }, data: { lastLeftAt: now } }),
  ]);
}

async function confirmViewer(liveId, userId, now = new Date()) {
  return prisma.$transaction(async tx => {
    const live = await tx.liveSession.findUnique({ where: { id: liveId }, select: { hostId: true, status: true } });
    if (!live || live.status !== 'ACTIVE' || live.hostId === userId) return null;
    const participant = await tx.projectionParticipant.findUnique({ where: { liveId_userId: { liveId, userId } } });
    if (!participant) return null;
    const currentEngagement = await tx.projectionEngagement.findUnique({ where: { userId } });
    if (currentEngagement?.liveId === liveId && participant.confirmedAt && now - participant.confirmedAt < 60000) return participant.confirmedAt;
    await tx.projectionParticipant.update({ where: { liveId_userId: { liveId, userId } }, data: { confirmedAt: now } });
    await tx.projectionEngagement.upsert({ where: { userId }, create: { userId, liveId, confirmedAt: now },
      update: { liveId, confirmedAt: now } });
    return now;
  });
}

async function settleHost(liveId, evidence, now = new Date()) {
  const liveOwner = await prisma.liveSession.findUnique({ where: { id: liveId }, select: { hostId: true } });
  if (!liveOwner) return null;
  return prisma.$transaction(async tx => {
    await reputation.locked(tx, liveOwner.hostId);
    await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${liveId} FOR UPDATE`;
    const live = await tx.liveSession.findUnique({ where: { id: liveId } });
    if (!live || live.status !== 'ACTIVE') return null;
    const seconds = Math.min(60, Math.max(0, Math.floor((now - (live.repTickAt || now)) / 1000)));
    const engaged = evidence.viewerIds.length ? await tx.projectionEngagement.findMany({
      where: { userId: { in: evidence.viewerIds }, liveId, confirmedAt: { gte: new Date(now.getTime() - ENGAGEMENT_MS) } },
      select: { userId: true, confirmedAt: true },
    }) : [];
    const validVideo = Boolean(evidence.playing && evidence.videoId && evidence.hostConnected && engaged.length);
    const validHost = validVideo && evidence.hostConnected;
    let hostRepSeconds = live.hostRepSeconds;
    let hostRepAccrued = live.hostRepAccrued;
    const eligibleSeconds = validHost ? Math.min(seconds, Math.max(0,
      Math.floor((now - new Date(Math.min(...engaged.map(row => row.confirmedAt.getTime())))) / 1000))) : 0;
    if (validHost && eligibleSeconds) {
      const day = reputation.dayDate(now);
      const daily = await tx.projectionDay.findUnique({ where: { userId_day: { userId: live.hostId, day } } });
      const calculated = hostAccrual(eligibleSeconds, hostRepSeconds, daily?.hostAccrued || 0);
      hostRepSeconds = calculated.carriedSeconds;
      hostRepAccrued += calculated.earned;
      if (calculated.earned) await tx.projectionDay.upsert({ where: { userId_day: { userId: live.hostId, day } },
        create: { userId: live.hostId, day, hostAccrued: calculated.earned },
        update: { hostAccrued: { increment: calculated.earned } } });
    }
    const updated = await tx.liveSession.update({ where: { id: liveId }, data: {
      repTickAt: now, hostRepSeconds, hostRepAccrued,
    } });
    return { live: updated, seconds, viewerIds: validVideo ? engaged.map(row => row.userId) : [] };
  });
}

async function settleViewer(liveId, userId, seconds, now = new Date()) {
  if (!seconds) return null;
  return prisma.$transaction(async tx => {
    const user = await reputation.locked(tx, userId);
    await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${liveId} FOR UPDATE`;
    const live = await tx.liveSession.findUnique({ where: { id: liveId }, select: { status: true, hostId: true, isPlaying: true, currentVideoId: true } });
    if (!live || live.status !== 'ACTIVE' || live.hostId === userId || !live.isPlaying || !live.currentVideoId) return null;
    const engagement = await tx.projectionEngagement.findUnique({ where: { userId } });
    if (engagement?.liveId !== liveId || now - engagement.confirmedAt > ENGAGEMENT_MS) return null;
    const participant = await tx.projectionParticipant.findUnique({ where: { liveId_userId: { liveId, userId } } });
    if (!participant || participant.repGranted >= VIEWER_LIVE_LIMIT) return null;
    const dayTotal = await tx.xpEvent.aggregate({ where: { userId, reason: 'LIVE_VIEWER', createdAt: reputation.dayWindow(now) }, _sum: { amount: true } });
    const eligibleSeconds = Math.min(seconds, Math.max(0, Math.floor((now - engagement.confirmedAt) / 1000)));
    const calculated = viewerAccrual(eligibleSeconds, participant.activeSeconds, participant.repGranted, dayTotal._sum.amount || 0);
    await tx.projectionParticipant.update({ where: { liveId_userId: { liveId, userId } }, data: {
      activeSeconds: calculated.carriedSeconds, repGranted: { increment: calculated.earned },
    } });
    if (!calculated.earned) return null;
    const result = await reputation.award(tx, user, calculated.earned, 'LIVE_VIEWER',
      `viewer:${liveId}:${userId}:${participant.repGranted + calculated.earned}`, now);
    await tx.liveSession.update({ where: { id: liveId }, data: { participantRepGranted: { increment: result.gainedXp } } });
    return result;
  });
}

async function settle(liveId, evidence, now = new Date()) {
  const host = await settleHost(liveId, evidence, now);
  if (!host) return null;
  const viewerAwards = [];
  for (const userId of new Set(host.viewerIds)) {
    const result = await settleViewer(liveId, userId, host.seconds, now);
    if (result?.gainedXp) viewerAwards.push({ userId, result });
  }
  return { host: host.live, viewerAwards };
}

async function finish(liveId, currentTime = 0, now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${liveId} FOR UPDATE`;
    const live = await tx.liveSession.findUnique({ where: { id: liveId }, select: { status: true } });
    if (!live || live.status === 'ENDED') return false;
    await tx.liveSession.update({ where: { id: liveId }, data: {
      status: 'ENDED', endedAt: now, isPlaying: false, currentTime,
    } });
    await tx.playlistItem.updateMany({ where: { liveId, status: { in: ['WAITING', 'PLAYING'] } }, data: { status: 'REMOVED' } });
    await tx.projectionVisit.updateMany({ where: { liveId, leftAt: null }, data: { leftAt: now } });
    await tx.projectionParticipant.updateMany({ where: { liveId, lastLeftAt: null }, data: { lastLeftAt: now } });
    return true;
  });
}

async function hostStatus(liveId, userId, now = new Date()) {
  const live = await prisma.liveSession.findUnique({ where: { id: liveId }, select: {
    hostId: true, status: true, hostRepAccrued: true, hostRepCollected: true,
  } });
  if (!live || live.hostId !== userId) return null;
  const day = reputation.dayDate(now);
  const [daily, collected] = await Promise.all([
    prisma.projectionDay.findUnique({ where: { userId_day: { userId, day } } }),
    prisma.xpEvent.aggregate({ where: { userId, reason: 'LIVE_HOST', createdAt: reputation.dayWindow(now) }, _sum: { amount: true } }),
  ]);
  const pending = live.hostRepAccrued - live.hostRepCollected;
  return { accrued: live.hostRepAccrued, collected: live.hostRepCollected, pending,
    progress: Math.min(HOST_COLLECT_LIMIT, pending), todayAccrued: daily?.hostAccrued || 0,
    todayCollected: collected._sum.amount || 0, collectable: collectionAmount(pending, collected._sum.amount || 0, live.status),
    status: live.status };
}

async function collectHost(liveId, userId, requestId, now = new Date()) {
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) throw Object.assign(new Error('Identificador de coleta inválido.'), { status: 400 });
  const result = await prisma.$transaction(async tx => {
    const user = await reputation.locked(tx, userId);
    await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${liveId} FOR UPDATE`;
    const live = await tx.liveSession.findUnique({ where: { id: liveId } });
    if (!live || live.hostId !== userId) throw Object.assign(new Error('Projeção não encontrada para este host.'), { status: 403 });
    const sourceKey = `projection-host:${liveId}:${requestId}`;
    const duplicate = await tx.xpEvent.findUnique({ where: { sourceKey }, select: { id: true } });
    if (duplicate) return { granted: 0, duplicate: true, xpResult: null };
    const pending = live.hostRepAccrued - live.hostRepCollected;
    const collected = await tx.xpEvent.aggregate({ where: { userId, reason: 'LIVE_HOST', createdAt: reputation.dayWindow(now) }, _sum: { amount: true } });
    const amount = collectionAmount(pending, collected._sum.amount || 0, live.status);
    if (!amount) return { granted: 0, duplicate: false, xpResult: null };
    const xpResult = await reputation.award(tx, user, amount, 'LIVE_HOST', sourceKey, now);
    await tx.liveSession.update({ where: { id: liveId }, data: { hostRepCollected: { increment: xpResult.gainedXp } } });
    return { granted: xpResult.gainedXp, duplicate: false, xpResult };
  });
  return { ...result, status: await hostStatus(liveId, userId, now) };
}

async function report(liveId, userId) {
  const live = await prisma.liveSession.findUnique({ where: { id: liveId }, include: {
    host: { select: { username: true } }, room: { select: { name: true } },
  } });
  if (!live) return null;
  const own = live.hostId === userId;
  const base = { id: live.id, status: live.status, hostName: live.host.username,
    roomName: live.roomName || live.room.name, startedAt: live.startedAt, endedAt: live.endedAt,
    durationSeconds: Math.max(0, Math.floor(((live.endedAt || new Date()) - live.startedAt) / 1000)),
    uniqueVisitors: live.uniqueVisitors, peakParticipants: live.peakParticipants,
    messageCount: live.messageCount, participantRepGranted: live.participantRepGranted, isHost: own };
  return own ? { ...base, hostRep: await hostStatus(liveId, userId) } : base;
}

module.exports = { HOST_DAILY_LIMIT, HOST_COLLECT_LIMIT, VIEWER_LIVE_LIMIT, VIEWER_DAILY_LIMIT,
  distinctViewerIds, hostAccrual, viewerAccrual, collectionAmount, recordJoin, recordLeave, confirmViewer,
  settle, finish, hostStatus, collectHost, report };
