const MAX_PEERS = 6;
const moderation = require('./moderation');
const MAX_ROOMS_PER_COMMUNITY = 3;
const KICK_MS = 5 * 60000;
const validRoomId = value => typeof value === 'string' && /^[a-z0-9_-]{1,50}$/.test(value);
const validVoiceId = value => typeof value === 'string' && /^[a-z0-9]{10,40}$/.test(value);
const response = (callback, value) => { if (typeof callback === 'function') callback(value); };
function iceServers() {
  if (!process.env.VOICE_ICE_SERVERS) return [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const rows = JSON.parse(process.env.VOICE_ICE_SERVERS);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5) throw new Error('lista inválida');
    for (const row of rows) {
      const urls = Array.isArray(row.urls) ? row.urls : [row.urls];
      if (!urls.length || urls.some(url => typeof url !== 'string' ||
        !/^(stun:|turn:|turns:)[^\s]{3,250}$/.test(url))) throw new Error('URL ICE inválida');
      if ((row.username !== undefined && typeof row.username !== 'string') ||
          (row.credential !== undefined && typeof row.credential !== 'string')) throw new Error('credencial ICE inválida');
    }
    return rows;
  } catch (error) { console.error('VOICE_ICE_SERVERS inválido:', error.message); return []; }
}

function createVoiceService({ io, prisma, getActiveLive }) {
  const configuredIceServers = iceServers();
  const bySocket = new Map();
  const byRoom = new Map();
  const kicked = new Map();
  const closing = new Set();
  const broadcastRooms = roomId => io.to(roomId).emit('voice:rooms-updated', { roomId });
  const membersOf = voiceRoomId => byRoom.get(voiceRoomId) || new Map();
  const participant = entry => ({ socketId: entry.socket.id, userId: entry.socket.user.id,
    username: entry.socket.user.username, avatar: entry.socket.user.avatar || null,
    muted: entry.muted, forcedMuted: entry.forcedMuted, speaking: entry.speaking });
  const broadcastMembers = voiceRoomId => io.to(`voice:${voiceRoomId}`).emit('voice:participants',
    { voiceRoomId, participants: [...membersOf(voiceRoomId).values()].map(participant) });
  async function access(socket, roomId, moderator = false) {
    if (!validRoomId(roomId) || !socket.rooms.has(roomId)) return false;
    const member = await prisma.roomMember.findUnique({ where: { userId_roomId: {
      userId: socket.user.id, roomId } }, select: { role: true } });
    if (!member) return false;
    return !moderator || socket.user.isSiteAdmin || ['OWNER', 'CO_ADMIN'].includes(member.role);
  }
  function leave(socket) {
    const entry = bySocket.get(socket.id);
    if (!entry) return false;
    bySocket.delete(socket.id);
    const members = membersOf(entry.voiceRoomId);
    members.delete(socket.id);
    if (!members.size) byRoom.delete(entry.voiceRoomId);
    socket.leave(`voice:${entry.voiceRoomId}`);
    io.to(`voice:${entry.voiceRoomId}`).emit('voice:peer-left',
      { voiceRoomId: entry.voiceRoomId, socketId: socket.id });
    broadcastMembers(entry.voiceRoomId);
    broadcastRooms(entry.roomId);
    return true;
  }
  async function list(socket, roomId) {
    if (!await access(socket, roomId)) return { success: false, message: 'Acesso à comunidade negado.' };
    const rooms = await prisma.voiceRoom.findMany({ where: { roomId, status: 'OPEN' },
      orderBy: { createdAt: 'asc' }, take: MAX_ROOMS_PER_COMMUNITY,
      select: { id: true, roomId: true, name: true, linkedLiveId: true, createdAt: true } });
    return { success: true, rooms: rooms.map(room => ({
      ...room, participantCount: membersOf(room.id).size, maxParticipants: MAX_PEERS,
      projectionActive: !!room.linkedLiveId && getActiveLive(roomId) === room.linkedLiveId,
    })) };
  }
  function signalValid(type, data) {
    if (!['offer', 'answer', 'candidate'].includes(type) || !data || typeof data !== 'object') return false;
    if (type === 'offer' || type === 'answer')
      return typeof data.sdp === 'string' && data.sdp.length > 0 && data.sdp.length <= 32000;
    return typeof data.candidate === 'string' && data.candidate.length <= 4000 &&
      (data.sdpMid === null || data.sdpMid === undefined || typeof data.sdpMid === 'string') &&
      (data.sdpMLineIndex === null || data.sdpMLineIndex === undefined ||
        (Number.isInteger(data.sdpMLineIndex) && data.sdpMLineIndex >= 0 && data.sdpMLineIndex < 32));
  }
  function attach(socket) {
    socket.on('voice:list', async ({ roomId } = {}, callback) => {
      try { response(callback, await list(socket, roomId)); }
      catch (error) { console.error('Erro ao listar salas de voz:', error);
        response(callback, { success: false, message: 'Não foi possível carregar as salas de voz.' }); }
    });
    socket.on('voice:create', async ({ roomId, name, linkProjection } = {}, callback) => {
      try {
        if (!await access(socket, roomId, true)) return response(callback,
          { success: false, message: 'Apenas moderadores podem criar salas de voz.' });
        const title = typeof name === 'string' ? name.trim() : '';
        if (title.length < 3 || title.length > 60 || typeof linkProjection !== 'boolean')
          return response(callback, { success: false, message: 'Informe um nome válido.' });
        const liveId = linkProjection ? getActiveLive(roomId) : null;
        if (linkProjection && !liveId) return response(callback,
          { success: false, message: 'Não há projeção ativa nesta comunidade.' });
        const room = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
          if (await tx.voiceRoom.count({ where: { roomId, status: 'OPEN' } }) >= MAX_ROOMS_PER_COMMUNITY)
            return null;
          return tx.voiceRoom.create({ data: { roomId, createdById: socket.user.id,
            name: title, linkedLiveId: liveId }, select: { id: true, roomId: true } });
        }, { timeout: 15000 });
        if (!room) return response(callback,
          { success: false, message: 'Esta comunidade já tem três salas de voz abertas.' });
        broadcastRooms(roomId);
        response(callback, { success: true, voiceRoomId: room.id });
      } catch (error) { console.error('Erro ao criar sala de voz:', error);
        response(callback, { success: false, message: 'Não foi possível criar a sala de voz.' }); }
    });
    socket.on('voice:join', async ({ voiceRoomId } = {}, callback) => {
      try {
        if (!validVoiceId(voiceRoomId) || closing.has(voiceRoomId))
          return response(callback, { success: false, message: 'Sala de voz indisponível.' });
        const room = await prisma.voiceRoom.findUnique({ where: { id: voiceRoomId },
          select: { id: true, roomId: true, name: true, status: true, linkedLiveId: true } });
        if (!room || room.status !== 'OPEN' || !await access(socket, room.roomId))
          return response(callback, { success: false, message: 'Acesso à sala de voz negado.' });
        if (await moderation.activeSanction(room.roomId, socket.user.id))
          return response(callback, { success: false, message: 'Você está temporariamente silenciado nesta comunidade.' });
        if (socket.user.presenceStatus === 'INVISIBLE') return response(callback,
          { success: false, message: 'Mude seu status de invisível para participar da voz.' });
        const existing = bySocket.get(socket.id);
        if (existing) return response(callback, { success: false,
          message: 'Saia da chamada atual antes de entrar em outra.' });
        if ([...bySocket.values()].some(entry => entry.socket.user.id === socket.user.id))
          return response(callback, { success: false, message: 'Sua conta já está em uma chamada.' });
        if ((kicked.get(voiceRoomId)?.get(socket.user.id) || 0) > Date.now())
          return response(callback, { success: false, message: 'Você foi removido desta chamada. Tente mais tarde.' });
        const members = membersOf(voiceRoomId);
        if (members.size >= MAX_PEERS) return response(callback,
          { success: false, message: 'Esta sala de voz está cheia.' });
        const peers = [...members.values()].map(participant);
        const entry = { socket, voiceRoomId, roomId: room.roomId, muted: false,
          forcedMuted: false, speaking: false, speakingAt: 0, signals: [] };
        members.set(socket.id, entry); byRoom.set(voiceRoomId, members); bySocket.set(socket.id, entry);
        socket.join(`voice:${voiceRoomId}`);
        response(callback, { success: true, room: { id: room.id, name: room.name,
          roomId: room.roomId, linkedLiveId: room.linkedLiveId },
          peers, self: participant(entry), maxParticipants: MAX_PEERS,
          iceServers: configuredIceServers });
        broadcastMembers(voiceRoomId);
        broadcastRooms(room.roomId);
      } catch (error) { console.error('Erro ao entrar na voz:', error);
        response(callback, { success: false, message: 'Não foi possível entrar na chamada.' }); }
    });
    socket.on('voice:leave', (_payload, callback) => {
      leave(socket); response(callback, { success: true });
    });
    socket.on('voice:self-mute', ({ muted } = {}, callback) => {
      const entry = bySocket.get(socket.id);
      if (!entry || typeof muted !== 'boolean' || (entry.forcedMuted && !muted))
        return response(callback, { success: false, message: 'Não é possível alterar o microfone.' });
      entry.muted = muted;
      if (muted) entry.speaking = false;
      broadcastMembers(entry.voiceRoomId);
      response(callback, { success: true, muted });
    });
    socket.on('voice:speaking', ({ speaking } = {}) => {
      const entry = bySocket.get(socket.id);
      if (!entry || typeof speaking !== 'boolean' || entry.muted || entry.forcedMuted ||
        Date.now() - entry.speakingAt < 250 || entry.speaking === speaking) return;
      entry.speaking = speaking; entry.speakingAt = Date.now();
      io.to(`voice:${entry.voiceRoomId}`).emit('voice:speaking',
        { voiceRoomId: entry.voiceRoomId, socketId: socket.id, speaking });
    });
    socket.on('voice:signal', ({ to, type, data } = {}, callback) => {
      const from = bySocket.get(socket.id);
      const target = typeof to === 'string' ? bySocket.get(to) : null;
      if (!from || !target || from.voiceRoomId !== target.voiceRoomId ||
        !signalValid(type, data)) return response(callback, { success: false });
      const now = Date.now();
      from.signals = from.signals.filter(at => now - at < 10000);
      if (from.signals.length >= 80) return response(callback, { success: false });
      from.signals.push(now);
      target.socket.emit('voice:signal', { from: socket.id, type, data });
      response(callback, { success: true });
    });
    socket.on('voice:moderate', async ({ voiceRoomId, targetSocketId, action } = {}, callback) => {
      try {
        const target = typeof targetSocketId === 'string' ? bySocket.get(targetSocketId) : null;
        if (!target || target.voiceRoomId !== voiceRoomId || !['mute', 'unmute', 'remove'].includes(action) ||
            target.socket.id === socket.id || !await access(socket, target.roomId, true))
          return response(callback, { success: false, message: 'Ação de moderação não autorizada.' });
        const [actorMember, targetMember] = await Promise.all([
          prisma.roomMember.findUnique({ where: { userId_roomId: {
            userId: socket.user.id, roomId: target.roomId } }, select: { role: true } }),
          prisma.roomMember.findUnique({ where: { userId_roomId: {
            userId: target.socket.user.id, roomId: target.roomId } }, select: { role: true } }),
        ]);
        if (!targetMember || target.socket.user.isSiteAdmin ||
            (!socket.user.isSiteAdmin && (targetMember.role === 'OWNER' ||
              (actorMember?.role === 'CO_ADMIN' && targetMember.role !== 'MEMBER'))))
          return response(callback, { success: false, message: 'Você não pode moderar este participante.' });
        if (action === 'remove') {
          if (!kicked.has(voiceRoomId)) kicked.set(voiceRoomId, new Map());
          kicked.get(voiceRoomId).set(target.socket.user.id, Date.now() + KICK_MS);
          leave(target.socket);
          target.socket.emit('voice:removed', { voiceRoomId, message: 'Você foi removido da chamada.' });
        } else {
          target.forcedMuted = action === 'mute';
          if (target.forcedMuted) { target.muted = true; target.speaking = false; }
          target.socket.emit('voice:force-mute', { voiceRoomId, forcedMuted: target.forcedMuted });
          broadcastMembers(voiceRoomId);
        }
        response(callback, { success: true });
      } catch (error) { console.error('Erro ao moderar voz:', error);
        response(callback, { success: false, message: 'Não foi possível moderar a chamada.' }); }
    });
    socket.on('voice:close', async ({ voiceRoomId } = {}, callback) => {
      try {
        if (!validVoiceId(voiceRoomId)) return response(callback, { success: false });
        const room = await prisma.voiceRoom.findUnique({ where: { id: voiceRoomId },
          select: { roomId: true, status: true } });
        if (!room || room.status !== 'OPEN' || !await access(socket, room.roomId, true))
          return response(callback, { success: false, message: 'Apenas moderadores podem encerrar a sala.' });
        closing.add(voiceRoomId);
        await prisma.voiceRoom.update({ where: { id: voiceRoomId },
          data: { status: 'CLOSED', closedAt: new Date() } });
        for (const entry of [...membersOf(voiceRoomId).values()]) {
          leave(entry.socket);
          entry.socket.emit('voice:closed', { voiceRoomId });
        }
        kicked.delete(voiceRoomId); closing.delete(voiceRoomId);
        broadcastRooms(room.roomId);
        response(callback, { success: true });
      } catch (error) { closing.delete(voiceRoomId);
        console.error('Erro ao encerrar voz:', error);
        response(callback, { success: false, message: 'Não foi possível encerrar a sala.' }); }
    });
    socket.on('disconnecting', () => leave(socket));
  }
  function removeUser(roomId, userId) {
    for (const entry of [...bySocket.values()]) if (entry.roomId === roomId &&
      entry.socket.user.id === userId) {
      leave(entry.socket);
      entry.socket.emit('voice:removed', { voiceRoomId: entry.voiceRoomId,
        message: 'Você foi removido da comunidade.' });
    }
  }
  function removeInvisible(userId) {
    for (const entry of [...bySocket.values()]) if (entry.socket.user.id === userId) {
      leave(entry.socket);
      entry.socket.emit('voice:removed', { voiceRoomId: entry.voiceRoomId,
        message: 'A chamada foi encerrada para preservar seu status invisível.' });
    }
  }
  async function unlinkProjection(liveId, roomId) {
    const updated = await prisma.voiceRoom.updateMany({ where: { linkedLiveId: liveId, status: 'OPEN' },
      data: { linkedLiveId: null } });
    if (updated.count) broadcastRooms(roomId);
  }
  return { attach, removeUser, removeInvisible, unlinkProjection, list };
}

module.exports = { MAX_PEERS, createVoiceService };
