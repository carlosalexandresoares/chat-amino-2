const socketUserSelect = {
  id: true, username: true, avatar: true, xp: true, level: true, isSiteAdmin: true,
};

async function loadSocketUser(prisma, id) {
  try {
    return await prisma.user.findUnique({
      where: { id }, select: { ...socketUserSelect, presenceStatus: true },
    });
  } catch (error) {
    if (error.code !== 'P2022') throw error;
    const user = await prisma.user.findUnique({ where: { id }, select: socketUserSelect });
    return user && { ...user, presenceStatus: 'ONLINE' };
  }
}

module.exports = { loadSocketUser };
