const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const prisma = require('../src/database/prisma');
const projection = require('../src/services/projectionRep');
const reputation = require('../src/services/reputation');

test('projeção: estatísticas, limites, coleta concorrente, fraude e nível', {
  skip: process.env.RUN_PROJECTION_DB_TESTS !== '1' && 'Defina RUN_PROJECTION_DB_TESTS=1 para testar no PostgreSQL',
  timeout: 120000,
}, async () => {
  const tag = randomUUID();
  const host = await prisma.user.create({ data: {
    username: `rep-host-${tag}`, email: `rep-host-${tag}@test.invalid`, password: 'test', xp: 90,
  } });
  let room;
  let viewer;
  let secondViewer;
  try {
    viewer = await prisma.user.create({ data: {
      username: `rep-viewer-${tag}`, email: `rep-viewer-${tag}@test.invalid`, password: 'test',
    } });
    secondViewer = await prisma.user.create({ data: {
      username: `rep-second-${tag}`, email: `rep-second-${tag}@test.invalid`, password: 'test',
    } });
    room = await prisma.room.create({ data: { name: 'Sala de teste REP', ownerId: host.id } });
    const start = new Date(Date.now() - 8 * 60000);
    const live = await prisma.liveSession.create({ data: {
      roomId: room.id, hostId: host.id, roomName: room.name, repTickAt: start,
      startedAt: start, currentVideoId: 'video-test', isPlaying: true, messageCount: 3,
    } });
    await projection.recordJoin(live.id, viewer.id, 1, start);
    await projection.recordJoin(live.id, viewer.id, 1, start);
    await projection.recordJoin(live.id, secondViewer.id, 2, start);
    await projection.recordLeave(live.id, viewer.id, new Date(start.getTime() + 1000));
    await projection.recordJoin(live.id, viewer.id, 2, new Date(start.getTime() + 2000));
    assert.equal(await prisma.projectionVisit.count({ where: { liveId: live.id, userId: viewer.id } }), 2);
    await projection.confirmViewer(live.id, viewer.id, start);

    await reputation.grant(viewer.id, 99, 'LIVE_VIEWER', `seed-viewer:${tag}`, start);
    await prisma.projectionParticipant.update({ where: { liveId_userId: { liveId: live.id, userId: viewer.id } },
      data: { activeSeconds: 299, repGranted: 29 } });
    const evidence = { playing: true, videoId: 'video-test', hostConnected: true, viewerIds: [viewer.id, viewer.id] };
    const settled = await projection.settle(live.id, evidence, new Date(start.getTime() + 60000));
    assert.equal(settled.viewerAwards.length, 1);
    assert.equal(settled.viewerAwards[0].result.gainedXp, 1);
    assert.equal((await prisma.liveSession.findUnique({ where: { id: live.id } })).hostRepAccrued, 1);
    assert.equal((await prisma.projectionParticipant.findUnique({ where: { liveId_userId: { liveId: live.id, userId: viewer.id } } })).repGranted, 30);
    await projection.settle(live.id, evidence, new Date(start.getTime() + 120000));
    assert.equal((await prisma.user.findUnique({ where: { id: viewer.id } })).xp, 100);

    await prisma.liveSession.update({ where: { id: live.id }, data: { hostRepAccrued: 25 } });
    await assert.rejects(projection.collectHost(live.id, viewer.id, randomUUID()), { status: 403 });
    const requestId = randomUUID();
    const collections = await Promise.all([
      projection.collectHost(live.id, host.id, requestId),
      projection.collectHost(live.id, host.id, requestId),
    ]);
    assert.deepEqual(collections.map(item => item.granted).sort((a, b) => a - b), [0, 25]);
    assert.equal((await prisma.user.findUnique({ where: { id: host.id } })).level, 2);

    await prisma.liveSession.update({ where: { id: live.id }, data: { hostRepAccrued: 50 } });
    assert.equal(await projection.finish(live.id, 120), true);
    assert.equal(await projection.finish(live.id, 120), false);
    const report = await projection.report(live.id, host.id);
    assert.equal(report.uniqueVisitors, 2);
    assert.equal(report.peakParticipants, 2);
    assert.equal(report.messageCount, 3);
    assert.equal(report.participantRepGranted, 1);
    assert.equal(report.hostRep.pending, 25);
    assert.equal((await projection.report(live.id, viewer.id)).hostRep, undefined);
    assert.equal(await prisma.projectionVisit.count({ where: { liveId: live.id, leftAt: null } }), 0);
    const final = await projection.collectHost(live.id, host.id, randomUUID());
    assert.equal(final.granted, 25);
    assert.equal(final.status.pending, 0);

    await reputation.grant(host.id, 200, 'LIVE_HOST', `seed-host:${tag}`);
    await prisma.liveSession.update({ where: { id: live.id }, data: { hostRepAccrued: 60 } });
    assert.equal((await projection.collectHost(live.id, host.id, randomUUID())).granted, 0);
    assert.equal((await projection.hostStatus(live.id, host.id)).pending, 10);
  } finally {
    if (room) await prisma.room.delete({ where: { id: room.id } });
    if (viewer) await prisma.user.delete({ where: { id: viewer.id } });
    if (secondViewer) await prisma.user.delete({ where: { id: secondViewer.id } });
    await prisma.user.delete({ where: { id: host.id } });
  }
});
