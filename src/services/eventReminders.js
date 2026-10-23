const prisma = require('../database/prisma');
const notifications = require('./notifications');

let running = false;
async function sendDueReminders(io, now = new Date()) {
  if (running) return 0;
  running = true;
  let sent = 0;
  try {
    const events = await prisma.communityEvent.findMany({ where: {
      status: 'SCHEDULED', startsAt: { gt: now, lte: new Date(now.getTime() + 3600000) },
    }, orderBy: { startsAt: 'asc' }, take: 300,
    select: { id: true, title: true, roomId: true, startsAt: true, timeZone: true, scheduleVersion: true } });
    for (const event of events) {
      const participants = await prisma.eventParticipant.findMany({ where: { eventId: event.id,
        reminderEnabled: true, user: { roomMemberships: { some: { roomId: event.roomId } },
          sanctions: { none: { roomId: event.roomId, type: 'SUSPEND', revokedAt: null,
            expiresAt: { gt: now } } } },
        OR: [{ remindedVersion: null }, { remindedVersion: { not: event.scheduleVersion } }] },
      take: 100, select: { userId: true } });
      if (!participants.length) continue;
      const users = participants.map(item => item.userId);
      const when = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short',
        timeZone: event.timeZone }).format(event.startsAt);
      await notifications.publishBatch({ recipientIds: users, kind: 'EVENT_REMINDER',
        sourcePrefix: `event:${event.id}:v${event.scheduleVersion}`,
        title: 'Seu evento está chegando', body: `${event.title} começa em ${when}.`,
        href: `/events.html?roomId=${encodeURIComponent(event.roomId)}&eventId=${encodeURIComponent(event.id)}`,
        io });
      await prisma.eventParticipant.updateMany({ where: { eventId: event.id,
        userId: { in: users }, reminderEnabled: true },
      data: { remindedVersion: event.scheduleVersion } });
      sent += users.length;
    }
  } finally { running = false; }
  return sent;
}

module.exports = { sendDueReminders };
