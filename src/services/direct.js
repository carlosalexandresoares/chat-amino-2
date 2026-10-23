const prisma = require('../database/prisma');

const pair = (left, right) => left < right ? [left, right] : [right, left];
const participant = (conversation, userId) => Boolean(conversation &&
  (conversation.userAId === userId || conversation.userBId === userId));
const otherId = (conversation, userId) => conversation.userAId === userId ? conversation.userBId : conversation.userAId;

async function access(userId, conversationId, db = prisma) {
  const conversation = await db.directConversation.findUnique({ where: { id: conversationId },
    select: { id: true, userAId: true, userBId: true, requesterId: true, status: true } });
  return participant(conversation, userId) ? conversation : null;
}

async function blocked(left, right, db = prisma) {
  return Boolean(await db.userBlock.findFirst({ where: { OR: [
    { blockerId: left, blockedId: right }, { blockerId: right, blockedId: left },
  ] }, select: { blockerId: true } }));
}

async function canRequest(senderId, recipient, db = prisma) {
  if (recipient.directPrivacy === 'NOBODY') return false;
  if (recipient.directPrivacy === 'EVERYONE') return true;
  const where = recipient.directPrivacy === 'FOLLOWERS'
    ? { followerId: senderId, followedId: recipient.id }
    : { followerId: recipient.id, followedId: senderId };
  return Boolean(await db.follow.findUnique({ where: { followerId_followedId: where }, select: { followerId: true } }));
}

const messageSelect = {
  id: true, conversationId: true, senderId: true, type: true, content: true, mediaId: true,
  replyToId: true, createdAt: true, deliveredAt: true, readAt: true, deletedAt: true,
  sender: { select: { id: true, username: true, avatar: true } },
  replyTo: { select: { id: true, content: true, type: true, deletedAt: true,
    sender: { select: { username: true } } } },
  reactions: { select: { userId: true, emoji: true } },
};

function publicMessage(message) {
  if (!message) return null;
  return { ...message, content: message.deletedAt ? '' : message.content,
    mediaId: message.deletedAt ? null : message.mediaId };
}

module.exports = { pair, participant, otherId, access, blocked, canRequest, messageSelect, publicMessage };
