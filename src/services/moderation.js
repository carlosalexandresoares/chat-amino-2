const prisma = require('../database/prisma');
const chat = require('./chatMessages');
const direct = require('./direct');
const feed = require('./socialFeed');

const reasons = new Set(['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'SCAM', 'OTHER']);
const kinds = new Set(['USER', 'MESSAGE', 'POST', 'ROOM', 'STICKER', 'DIRECT']);
const problem = (message, status = 400) => Object.assign(new Error(message), { status });

async function moderator(userId, roomId, db = prisma) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { isSiteAdmin: true } });
  if (!user) return null;
  const member = await db.roomMember.findUnique({ where: { userId_roomId: { userId, roomId } },
    select: { role: true } });
  if (!member || (!user.isSiteAdmin && !['OWNER', 'CO_ADMIN'].includes(member.role))) return null;
  return { role: member.role, isSiteAdmin: user.isSiteAdmin };
}

async function canModerateUser(actorId, targetId, roomId, db = prisma) {
  if (actorId === targetId) return false;
  const actor = await moderator(actorId, roomId, db);
  if (!actor) return false;
  const target = await db.roomMember.findUnique({ where: { userId_roomId: { userId: targetId, roomId } },
    select: { role: true, user: { select: { isSiteAdmin: true } } } });
  if (!target || target.user.isSiteAdmin) return false;
  if (actor.isSiteAdmin) return true;
  return target.role === 'MEMBER' || actor.role === 'OWNER' && target.role === 'CO_ADMIN';
}

async function activeSanction(roomId, userId, types = ['MUTE', 'SUSPEND'], db = prisma) {
  return db.communitySanction.findFirst({ where: { roomId, userId, type: { in: types },
    revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { expiresAt: 'desc' },
  });
}

async function reportTarget(reporterId, kind, targetId) {
  if (kind === 'USER') {
    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, username: true } });
    if (!user || user.id === reporterId) throw problem('Perfil indisponível.', 404);
    return { subjectUserId: user.id, evidence: `Perfil: ${user.username}` };
  }
  if (kind === 'ROOM') {
    const room = await prisma.room.findUnique({ where: { id: targetId }, select: { name: true } });
    if (!room) throw problem('Comunidade indisponível.', 404);
    return { evidence: `Comunidade: ${room.name}` };
  }
  if (kind === 'MESSAGE') {
    const message = await prisma.message.findUnique({ where: { id: targetId },
      select: { userId: true, roomId: true, content: true, type: true, deletedAt: true } });
    if (!message || message.deletedAt || message.userId === reporterId ||
        !await chat.roomAccess(reporterId, message.roomId)) throw problem('Mensagem indisponível.', 404);
    return { roomId: message.roomId, subjectUserId: message.userId, evidence: message.type === 'TEXT' ?
      message.content.slice(0, 500) : `Conteúdo ${message.type}` };
  }
  if (kind === 'POST') {
    const post = await feed.visiblePost(reporterId, targetId);
    if (!post || post.userId === reporterId) throw problem('Publicação indisponível.', 404);
    return { roomId: post.roomId || null, subjectUserId: post.userId,
      evidence: post.content?.slice(0, 500) || 'Publicação' };
  }
  if (kind === 'STICKER') {
    const sticker = await prisma.sticker.findFirst({ where: { OR: [{ id: targetId }, { assetId: targetId }] },
      select: { ownerId: true, assetId: true, name: true } });
    if (!sticker || sticker.ownerId === reporterId) throw problem('Figurinha indisponível.', 404);
    const message = await prisma.message.findFirst({ where: { mediaId: sticker.assetId,
      room: { members: { some: { userId: reporterId } } } }, select: { roomId: true } });
    if (!message) throw problem('Figurinha indisponível.', 404);
    return { roomId: message.roomId, subjectUserId: sticker.ownerId,
      evidence: `Figurinha: ${sticker.name}` };
  }
  if (kind === 'DIRECT') {
    const conversation = await direct.access(reporterId, targetId);
    if (!conversation) throw problem('Conversa indisponível.', 404);
    return { evidence: 'Conversa privada' };
  }
  throw problem('Tipo de denúncia inválido.');
}

async function submitReport({ reporterId, kind, targetId, reason, details = '' }) {
  if (!kinds.has(kind) || typeof targetId !== 'string' || targetId.length > 100 ||
      !reasons.has(reason) || typeof details !== 'string' || details.trim().length > 500)
    throw problem('Denúncia inválida.');
  const target = await reportTarget(reporterId, kind, targetId);
  const recent = await prisma.moderationReport.count({ where: { reporterId,
    createdAt: { gte: new Date(Date.now() - 3600000) } } });
  if (recent >= 10) throw problem('Limite de denúncias atingido. Tente mais tarde.', 429);
  try {
    return await prisma.moderationReport.create({ data: { reporterId, kind, targetId, reason,
      details: details.trim() || null, roomId: target.roomId || null, evidence: target.evidence || null,
      subjectUserId: target.subjectUserId || null } });
  } catch (error) {
    if (error.code === 'P2002') throw problem('Você já denunciou este conteúdo.', 409);
    throw error;
  }
}

module.exports = { problem, moderator, canModerateUser, activeSanction, submitReport };
