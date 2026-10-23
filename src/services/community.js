const prisma = require('../database/prisma');

const topics = [
  ['GERAL', 'Conversas gerais'], ['ANIME', 'Anime e mangá'], ['JOGOS', 'Jogos'],
  ['MUSICA', 'Música'], ['TECNOLOGIA', 'Tecnologia'], ['FILMES', 'Filmes e séries'],
  ['ARTE', 'Arte'], ['OUTROS', 'Outras'],
];
const topicCodes = new Set(topics.map(([code]) => code));

async function roomRole(userId, roomId, db = prisma) {
  const room = await db.room.findUnique({ where: { id: roomId }, select: { id: true, ownerId: true } });
  if (!room || (roomId !== 'geral' && !room.ownerId)) return null;
  const member = await db.roomMember.findUnique({ where: { userId_roomId: { userId, roomId } }, select: { role: true } });
  if (room.ownerId === userId) return 'OWNER';
  return member?.role || null;
}

function canModerate(role, isSiteAdmin) { return Boolean(isSiteAdmin || role === 'OWNER' || role === 'CO_ADMIN'); }

module.exports = { topics, topicCodes, roomRole, canModerate };
