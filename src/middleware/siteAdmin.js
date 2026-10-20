const prisma = require('../database/prisma');

async function isSiteAdmin(userId, client = prisma) {
  if (!userId) return false;
  const user = await client.user.findUnique({ where: { id: userId }, select: { isSiteAdmin: true } });
  return Boolean(user?.isSiteAdmin);
}

async function requireSiteAdmin(req, res, next) {
  try {
    if (!await isSiteAdmin(req.userId)) return res.status(403).json({ message: 'Acesso restrito ao administrador geral.' });
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { isSiteAdmin, requireSiteAdmin };
