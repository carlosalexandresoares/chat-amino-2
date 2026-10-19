const prisma = require('../database/prisma');
const reputation = require('./reputation');

const authorSelect = { id: true, username: true, avatar: true, level: true, xp: true };
const replySelect = { id: true, content: true, type: true, deletedAt: true,
  user: { select: { username: true } } };
const messageSelect = { id: true, clientKey: true, content: true, type: true, mediaId: true,
  createdAt: true, deletedAt: true, roomId: true, replyToId: true,
  user: { select: authorSelect }, media: { select: { duration: true, mimeType: true } },
  replyTo: { select: replySelect }, reactions: { select: { emoji: true, userId: true } } };

function format(message) {
  const unavailable = Boolean(message.deletedAt);
  return { id: message.id, roomId: message.roomId, type: unavailable ? 'TEXT' : message.type,
    message: unavailable ? 'Mensagem indisponível' : message.content,
    mediaId: unavailable ? null : message.mediaId,
    media: unavailable ? null : message.media,
    deleted: unavailable, replyToId: message.replyToId,
    replyTo: message.replyToId ? message.replyTo ? {
      id: message.replyTo.id, user: message.replyTo.user.username,
      type: message.replyTo.type, message: message.replyTo.deletedAt ? 'Mensagem indisponível' :
        message.replyTo.type === 'AUDIO' ? 'Áudio' : message.replyTo.type === 'STICKER' ? 'Figurinha' : message.replyTo.content.slice(0, 100),
      deleted: Boolean(message.replyTo.deletedAt),
    } : { id: message.replyToId, user: '', message: 'Mensagem indisponível', deleted: true } : null,
    reactions: message.reactions || [],
    user: { id: message.user.id, username: message.user.username, avatar: message.user.avatar,
      level: message.user.level, title: reputation.progress(message.user.xp).title },
    createdAt: message.createdAt.toISOString() };
}

async function load(id, db = prisma) {
  const message = await db.message.findUnique({ where: { id }, select: messageSelect });
  return message ? format(message) : null;
}

async function roomAccess(userId, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, ownerId: true } });
  if (!room) return false;
  if (room.ownerId === userId) return true;
  return Boolean(await prisma.roomMember.findUnique({ where: { userId_roomId: { userId, roomId } }, select: { id: true } }));
}

module.exports = { messageSelect, format, load, roomAccess };
