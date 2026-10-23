require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../src/database/prisma');
const reminders = require('../src/services/eventReminders');

test('eventos: acesso, inscrições concorrentes, lembretes, reagendamento e cancelamento', {
  skip: process.env.RUN_EVENTS_LIVE_TESTS !== '1' &&
    'Defina RUN_EVENTS_LIVE_TESTS=1 com servidor local e banco migrado',
  timeout: 180000,
}, async () => {
  const base = process.env.EVENTS_LIVE_URL || 'http://localhost:3000';
  const tag = randomUUID();
  const users = [];
  let roomId;
  const call = (user, route, method = 'GET', body) => fetch(base + route, { method,
    headers: { Authorization: `Bearer ${jwt.sign({ sub: user.id }, process.env.JWT_SECRET)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = async response => { const data = await response.json();
    assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`); return data; };
  try {
    for (const name of ['owner', 'member1', 'member2', 'outsider']) users.push(
      await prisma.user.create({ data: { username: `event-${name}-${tag}`,
        email: `event-${name}-${tag}@test.invalid`, password: 'test' } }));
    const [owner, member1, member2, outsider] = users;
    const room = await json(await call(owner, '/api/rooms', 'POST', { name: `Eventos ${tag.slice(0, 8)}` }));
    roomId = room.room.id;
    await prisma.roomMember.createMany({ data: [member1, member2].map(user => ({
      userId: user.id, roomId })) });
    const startsAt = new Date(Date.now() + 3 * 3600000).toISOString();
    const created = await json(await call(owner, '/api/events', 'POST', { roomId,
      type: 'PROJECTION', title: 'Sessão especial', description: 'Assistir juntos',
      startsAt, timeZone: 'America/Sao_Paulo', capacity: 1 }));
    const id = created.eventId;
    assert.equal((await call(outsider, `/api/events/${id}`)).status, 403);
    assert.equal((await call(outsider, `/api/events?roomId=${roomId}`)).status, 403);
    assert.equal((await call(member1, '/api/events', 'POST', { roomId, type: 'QUIZ',
      title: 'Quiz ilegal', startsAt, timeZone: 'UTC' })).status, 403);
    const registrations = await Promise.all([member1, member2].map(user =>
      call(user, `/api/events/${id}/register`, 'POST')));
    assert.deepEqual(registrations.map(result => result.status).sort(), [200, 409]);
    const winner = registrations[0].ok ? member1 : member2;
    const loser = winner.id === member1.id ? member2 : member1;
    assert.equal((await json(await call(owner, `/api/events/${id}`))).event.participantCount, 1);
    assert.equal((await call(loser, `/api/events/${id}/reschedule`, 'PUT', {
      startsAt, timeZone: 'UTC' })).status, 403);
    assert.equal((await call(loser, `/api/events/${id}/reminder`, 'PUT', { enabled: false })).status, 404);
    assert.equal((await json(await call(winner, `/api/events/${id}/reminder`, 'PUT',
      { enabled: false }))).reminderEnabled, false);
    assert.equal((await json(await call(winner, `/api/events/${id}/reminder`, 'PUT',
      { enabled: true }))).reminderEnabled, true);
    await json(await call(owner, `/api/events/${id}/reschedule`, 'PUT', {
      startsAt: new Date(Date.now() + 45 * 60000).toISOString(), timeZone: 'UTC' }));
    assert.equal(await reminders.sendDueReminders(null), 1);
    assert.equal(await reminders.sendDueReminders(null), 0);
    assert.equal(await prisma.notification.count({ where: { recipientId: winner.id,
      kind: 'EVENT_REMINDER' } }), 1);
    assert.equal(await prisma.notification.count({ where: { recipientId: loser.id,
      kind: 'EVENT_REMINDER' } }), 0);
    assert.equal((await json(await call(winner, `/api/events/${id}/register`, 'DELETE'))).registered, false);
    assert.equal((await json(await call(loser, `/api/events/${id}/register`, 'POST'))).registered, true);
    assert.equal((await call(loser, `/api/events/${id}/checkin`, 'POST')).status, 409);
    await prisma.communityEvent.update({ where: { id }, data: {
      startsAt: new Date(Date.now() - 10 * 60000) } });
    assert.equal((await json(await call(loser, `/api/events/${id}/checkin`, 'POST'))).attended, true);
    assert.equal((await json(await call(loser, `/api/events/${id}/checkin`, 'POST'))).attended, true);
    assert.equal((await call(loser, `/api/events/${id}/register`, 'DELETE')).status, 409);
    assert.equal((await json(await call(loser,
      '/api/gamification/missions/weekly_event/claim', 'POST'))).balance, 20);
    await json(await call(owner, `/api/events/${id}/cancel`, 'POST'));
    assert.equal((await call(winner, `/api/events/${id}/register`, 'POST')).status, 409);
    assert.equal((await json(await call(owner, `/api/events/${id}`))).event.status, 'CANCELLED');
  } finally {
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    for (const user of users.reverse()) await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
