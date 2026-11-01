const direct = require('./direct');

const reply = (callback, result) => { if (typeof callback === 'function') callback(result); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 60;
const validSignal = (type, data) => {
  if (!['offer', 'answer', 'candidate', 'screen-offer', 'screen-answer', 'screen-candidate'].includes(type) ||
      !data || typeof data !== 'object') return false;
  if (type.endsWith('candidate')) return typeof data.candidate === 'string' && data.candidate.length <= 4000;
  return typeof data.sdp === 'string' && data.sdp.length > 0 && data.sdp.length <= 32000;
};

function createDirectMediaService({ io, prisma, iceServers }) {
  const sessions = new Map();
  const bySocket = new Map();
  const roomName = id => `direct-media:${id}`;
  const members = session => [...session.members.values()].map(entry => ({
    socketId: entry.socket.id, userId: entry.socket.user.id,
    username: entry.socket.user.username, sharing: entry.sharing,
  }));
  function broadcast(session) {
    io.to(roomName(session.id)).emit('direct-media:state', {
      conversationId: session.id, participants: members(session), watch: session.watch,
    });
  }
  function leave(socket) {
    const entry = bySocket.get(socket.id);
    if (!entry) return;
    bySocket.delete(socket.id);
    const session = sessions.get(entry.conversationId);
    if (!session) return;
    session.members.delete(socket.id);
    if (session.watch?.ownerId === socket.user.id) session.watch = null;
    socket.leave(roomName(session.id));
    io.to(roomName(session.id)).emit('direct-media:peer-left', {
      conversationId: session.id, socketId: socket.id,
    });
    if (session.members.size) broadcast(session);
    else sessions.delete(session.id);
  }
  function removeConversation(conversationId) {
    const session = sessions.get(conversationId);
    if (!session) return;
    for (const entry of [...session.members.values()]) {
      entry.socket.emit('direct-media:closed', { conversationId });
      leave(entry.socket);
    }
  }
  async function access(socket, conversationId) {
    if (!validId(conversationId)) return null;
    const conversation = await direct.access(socket.user.id, conversationId, prisma);
    if (!conversation || conversation.status !== 'ACTIVE' ||
        await direct.blocked(conversation.userAId, conversation.userBId, prisma)) return null;
    return conversation;
  }
  function attach(socket) {
    socket.on('direct-media:join', async ({ conversationId } = {}, callback) => {
      try {
        if (!await access(socket, conversationId)) return reply(callback,
          { success: false, message: 'Conversa indisponível para assistir juntos.' });
        const current = bySocket.get(socket.id);
        if (current && current.conversationId !== conversationId) leave(socket);
        let session = sessions.get(conversationId);
        if (!session) {
          session = { id: conversationId, members: new Map(), watch: null };
          sessions.set(conversationId, session);
        }
        if (!session.members.has(socket.id) && [...session.members.values()].some(entry =>
          entry.socket.user.id === socket.user.id)) return reply(callback,
          { success: false, message: 'Sua conta já está nesta sessão em outra janela.' });
        const peers = members(session);
        const entry = { socket, conversationId, sharing: false, signals: [] };
        session.members.set(socket.id, entry);
        bySocket.set(socket.id, entry);
        socket.join(roomName(conversationId));
        reply(callback, { success: true, participants: members(session), peers,
          watch: session.watch, iceServers });
        broadcast(session);
      } catch (error) {
        console.error('Erro ao entrar em mídia privada:', error);
        reply(callback, { success: false, message: 'Não foi possível abrir a sessão.' });
      }
    });
    socket.on('direct-media:leave', (_payload, callback) => {
      leave(socket); reply(callback, { success: true });
    });
    socket.on('direct-media:share', ({ sharing } = {}, callback) => {
      const entry = bySocket.get(socket.id);
      const session = entry && sessions.get(entry.conversationId);
      if (!session || typeof sharing !== 'boolean') return reply(callback, { success: false });
      if (sharing && [...session.members.values()].some(member => member !== entry && member.sharing))
        return reply(callback, { success: false, message: 'A outra pessoa já está compartilhando a tela.' });
      entry.sharing = sharing;
      broadcast(session);
      reply(callback, { success: true });
    });
    socket.on('direct-media:signal', ({ to, type, data } = {}, callback) => {
      const from = bySocket.get(socket.id);
      const target = typeof to === 'string' ? bySocket.get(to) : null;
      if (!from || !target || from.conversationId !== target.conversationId ||
          from.socket.user.id === target.socket.user.id || !validSignal(type, data))
        return reply(callback, { success: false });
      if (type.startsWith('screen-') &&
          (type === 'screen-offer' && !from.sharing || type === 'screen-answer' && !target.sharing ||
           type === 'screen-candidate' && !from.sharing && !target.sharing))
        return reply(callback, { success: false });
      if (!type.startsWith('screen-') &&
          (type === 'offer' && !from.sharing || type === 'answer' && !target.sharing ||
           type === 'candidate' && !from.sharing && !target.sharing))
        return reply(callback, { success: false });
      const now = Date.now();
      from.signals = from.signals.filter(at => now - at < 10000);
      if (from.signals.length >= 80) return reply(callback, { success: false });
      from.signals.push(now);
      target.socket.emit('direct-media:signal', { conversationId: from.conversationId,
        from: socket.id, type, data });
      reply(callback, { success: true });
    });
    socket.on('direct-media:watch', ({ action, videoId, position } = {}, callback) => {
      const entry = bySocket.get(socket.id);
      const session = entry && sessions.get(entry.conversationId);
      if (!session || !['load', 'play', 'pause', 'seek', 'stop'].includes(action))
        return reply(callback, { success: false });
      if (action === 'load') {
        if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
          return reply(callback, { success: false, message: 'Link do YouTube inválido.' });
        session.watch = { videoId, position: 0, playing: false, changedAt: Date.now(),
          ownerId: socket.user.id };
      } else {
        if (!session.watch) return reply(callback, { success: false, message: 'Escolha um vídeo primeiro.' });
        const elapsed = session.watch.playing ? (Date.now() - session.watch.changedAt) / 1000 : 0;
        const current = session.watch.position + elapsed;
        if (action === 'stop') session.watch = null;
        else {
          if (action === 'seek' && (!Number.isFinite(position) || position < 0 || position > 86400))
            return reply(callback, { success: false });
          session.watch.position = action === 'seek' ? position : current;
          session.watch.playing = action === 'play' ? true : action === 'pause' ? false : session.watch.playing;
          session.watch.changedAt = Date.now();
        }
      }
      broadcast(session);
      reply(callback, { success: true, watch: session.watch });
    });
    socket.on('disconnecting', () => leave(socket));
  }
  return { attach, leave, removeConversation };
}

module.exports = { createDirectMediaService, validSignal };
