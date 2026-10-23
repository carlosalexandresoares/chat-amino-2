require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const prisma = require('../src/database/prisma');
const io = require(path.join(__dirname, '../node_modules/socket.io/client-dist/socket.io.js'));

test('comunidades: descoberta, favoritos, busca, fixação e enquetes respeitam permissões', {
  skip: process.env.RUN_COMMUNITY_LIVE_TESTS !== '1' && 'Defina RUN_COMMUNITY_LIVE_TESTS=1 com servidor local e banco migrado',
  timeout: 120000,
}, async () => {
  const tag = randomUUID();
  const base = process.env.COMMUNITY_LIVE_URL || 'http://localhost:3000';
  const users = [];
  const sockets = [];
  let roomId;
  const token = user => jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
  const call = (user, route, method = 'GET', body) => fetch(`${base}${route}`, {
    method, headers: { Authorization: `Bearer ${token(user)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const event = (socket, name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, onEvent); reject(new Error(`${name} não chegou`)); }, 10000);
    function onEvent(payload) { clearTimeout(timer); resolve(payload); }
    socket.once(name, onEvent);
  });
  try {
    for (const name of ['owner', 'member', 'outsider']) users.push(await prisma.user.create({ data: {
      username: `community-${name}-${tag}`, email: `community-${name}-${tag}@test.invalid`, password: 'test',
    } }));
    const [owner, member, outsider] = users;
    assert.equal((await call(owner, '/api/community/topics')).status, 200);
    const created = await call(owner, '/api/rooms', 'POST', { name: `Clube ${tag.slice(0, 8)}`,
      description: 'Anime e discussões', topic: 'ANIME' });
    assert.equal(created.status, 201);
    roomId = (await created.json()).room.id;
    const summary = await (await call(member, `/api/rooms/${roomId}/summary`)).json();
    assert.equal(summary.room.topic, 'ANIME');
    assert.equal(summary.room.membersCount, 1);
    const discover = await call(member, `/api/community/discover?search=${tag.slice(0, 8)}&topic=ANIME&sort=recent`);
    assert.equal(discover.status, 200);
    const found = (await discover.json()).rooms;
    assert.equal(found.length, 1);
    assert.equal(found[0].topic, 'ANIME');
    assert.equal(found[0].isMember, false);
    assert.equal((await call(member, `/api/community/rooms/${roomId}/favorite`, 'PUT')).status, 200);
    const favorites = await (await call(member, '/api/community/discover?favorites=true')).json();
    assert.ok(favorites.rooms.some(room => room.id === roomId && room.isFavorite));
    assert.equal((await call(member, `/api/community/rooms/${roomId}/favorite`, 'DELETE')).status, 200);
    assert.equal((await call(member, '/api/community/interests', 'PUT', { topics: ['ANIME'] })).status, 200);
    assert.deepEqual((await (await call(member, '/api/community/interests')).json()).topics, ['ANIME']);
    const recommended = await (await call(member, '/api/community/discover?sort=forYou')).json();
    assert.equal(recommended.rooms[0].id, roomId);
    assert.equal(recommended.rooms[0].interestMatch, true);
    assert.equal((await call(member, '/api/community/interests', 'PUT', { topics: ['BAD'] })).status, 400);
    assert.equal((await call(outsider, `/api/community/rooms/${roomId}/pins`)).status, 403);
    assert.equal((await call(outsider, `/api/community/rooms/${roomId}/polls`)).status, 403);
    assert.equal((await call(outsider, `/api/community/rooms/${roomId}/search?q=anime`)).status, 403);

    const socket = io(base, { auth: { token: token(member) }, transports: ['websocket'], reconnection: false });
    sockets.push(socket); await event(socket, 'connect');
    const history = event(socket, 'chat-history'); socket.emit('join-room', roomId); await history;
    assert.ok(await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: member.id, roomId } } }));
    const message = await prisma.message.create({ data: { roomId, userId: owner.id, content: 'Anime Naruto em discussão' } });
    const search = await (await call(member, `/api/community/rooms/${roomId}/search?q=Naruto&author=${encodeURIComponent(owner.username)}&type=TEXT`)).json();
    assert.equal(search.messages[0].id, message.id);
    assert.equal((await call(member, `/api/community/rooms/${roomId}/pins/${message.id}`, 'PUT')).status, 403);
    const pinEvent = event(socket, 'room-pins-updated');
    assert.equal((await call(owner, `/api/community/rooms/${roomId}/pins/${message.id}`, 'PUT')).status, 200);
    assert.equal((await pinEvent).roomId, roomId);
    const pins = await (await call(member, `/api/community/rooms/${roomId}/pins`)).json();
    assert.equal(pins.pins[0].messageId, message.id);
    assert.equal((await call(owner, `/api/community/rooms/${roomId}/pins/${message.id}`, 'DELETE')).status, 200);

    const pollCreated = await call(owner, `/api/community/rooms/${roomId}/polls`, 'POST', {
      question: 'Qual anime assistir?', options: ['Naruto', 'One Piece'],
      closesAt: new Date(Date.now() + 3600000).toISOString(), allowMultiple: false, allowChange: false,
    });
    assert.equal(pollCreated.status, 201);
    const pollId = (await pollCreated.json()).pollId;
    const polls = await (await call(member, `/api/community/rooms/${roomId}/polls`)).json();
    const poll = polls.polls.find(item => item.id === pollId);
    assert.ok(poll);
    assert.equal((await call(outsider, `/api/community/polls/${pollId}/vote`, 'PUT', { optionIds: [poll.options[0].id] })).status, 403);
    assert.equal((await call(member, `/api/community/polls/${pollId}/vote`, 'PUT', { optionIds: ['wrong'] })).status, 400);
    assert.equal((await call(member, `/api/community/polls/${pollId}/vote`, 'PUT', { optionIds: [poll.options[0].id] })).status, 200);
    assert.equal((await call(member, `/api/community/polls/${pollId}/vote`, 'PUT', { optionIds: [poll.options[1].id] })).status, 400);
    const after = await (await call(member, `/api/community/rooms/${roomId}/polls`)).json();
    assert.equal(after.polls[0].options[0].votes, 1);
    assert.deepEqual(after.polls[0].selectedOptionIds, [poll.options[0].id]);
    assert.equal((await call(member, `/api/community/polls/${pollId}`, 'DELETE')).status, 403);
    assert.equal((await call(owner, `/api/community/polls/${pollId}`, 'DELETE')).status, 200);

    const flexibleResponse = await call(owner, `/api/community/rooms/${roomId}/polls`, 'POST', {
      question: 'Quais séries assistir?', options: ['Série A', 'Série B', 'Série C'],
      closesAt: new Date(Date.now() + 3600000).toISOString(), allowMultiple: true, allowChange: true,
    });
    assert.equal(flexibleResponse.status, 201);
    const flexibleId = (await flexibleResponse.json()).pollId;
    const flexible = (await (await call(member, `/api/community/rooms/${roomId}/polls`)).json()).polls[0];
    assert.equal((await call(member, `/api/community/polls/${flexibleId}/vote`, 'PUT', {
      optionIds: flexible.options.slice(0, 2).map(option => option.id),
    })).status, 200);
    const duplicates = await Promise.all([1, 2].map(() => call(member, `/api/community/polls/${flexibleId}/vote`, 'PUT', {
      optionIds: [flexible.options[2].id],
    })));
    assert.deepEqual(duplicates.map(response => response.status), [200, 200]);
    assert.equal(await prisma.pollVote.count({ where: { pollId: flexibleId, userId: member.id } }), 1);
    await prisma.poll.update({ where: { id: flexibleId }, data: { closesAt: new Date(Date.now() - 1000) } });
    assert.equal((await call(member, `/api/community/polls/${flexibleId}/vote`, 'PUT', {
      optionIds: [flexible.options[0].id],
    })).status, 400);

    const directCreated = await call(owner, '/api/direct/conversations', 'POST', { userId: member.id });
    assert.equal(directCreated.status, 201);
    const conversation = (await directCreated.json()).conversation;
    assert.equal((await call(member, `/api/direct/conversations/${conversation.id}/request`, 'PATCH', { action: 'accept' })).status, 200);
    const sent = await call(owner, `/api/direct/conversations/${conversation.id}/messages`, 'POST', { content: 'Busca privada especial' });
    assert.equal(sent.status, 201);
    const day = new Date().toISOString().slice(0, 10);
    const filtered = await call(member, `/api/direct/conversations/${conversation.id}/messages?search=especial&author=other&type=TEXT&from=${day}T00:00:00Z&to=${day}T23:59:59Z`);
    assert.equal(filtered.status, 200);
    assert.equal((await filtered.json()).messages.length, 1);
    const mine = await (await call(member, `/api/direct/conversations/${conversation.id}/messages?author=me&type=TEXT`)).json();
    assert.equal(mine.messages.length, 0);
    assert.equal((await call(outsider, `/api/direct/conversations/${conversation.id}/messages?search=especial`)).status, 404);
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  }
});
