async function publish({ db, notifications, io, messageId, actor, excludedIds = [], href }) {
  const excluded = [...new Set([actor.id, ...excludedIds])];
  let cursor;
  for (;;) {
    const users = await db.user.findMany({
      where: { id: { notIn: excluded }, nativePushDevices: { some: {} } },
      orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true },
    });
    if (!users.length) return;
    await notifications.publishBatch({ recipientIds: users.map(user => user.id), actorId: actor.id,
      kind: 'CHAT_MESSAGE', sourcePrefix: `chat:${messageId}`, title: 'Nova mensagem no Chat Geral',
      body: `${actor.username} enviou uma mensagem.`, href, io, db });
    if (users.length < 100) return;
    cursor = users.at(-1).id;
  }
}

module.exports = { publish };
