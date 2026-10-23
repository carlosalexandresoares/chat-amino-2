const buckets = new Map();
const authBuckets = new Map();
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 'cutt.ly', 't.co', 'is.gd']);

function prune(bucket, windowMs, now) {
  while (bucket.length && now - bucket[0].at > windowMs) bucket.shift();
}

function suspiciousLink(message) {
  if (/(?:javascript|data|file):/i.test(message)) return true;
  for (const match of message.matchAll(/https?:\/\/[^\s<>]+/gi)) {
    try {
      const url = new URL(match[0]);
      if (url.username || url.password || url.hostname.startsWith('xn--') ||
          url.hostname.includes('.xn--') || SHORTENERS.has(url.hostname) ||
          /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.startsWith('[')) return true;
    } catch { return true; }
  }
  return false;
}

function allowMessage(userId, roomId, content, now = Date.now()) {
  const key = `${userId}:${roomId}`;
  const bucket = buckets.get(key) || [];
  prune(bucket, 90000, now);
  const normalized = content.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').slice(0, 500);
  if (bucket.filter(item => now - item.at < 60000).length >= 20)
    return { allowed: false, message: 'Muitas mensagens em pouco tempo. Aguarde um minuto.' };
  if (normalized && bucket.filter(item => item.content === normalized).length >= 3)
    return { allowed: false, message: 'Evite repetir a mesma mensagem.' };
  if (suspiciousLink(content)) return { allowed: false,
    message: 'Este link parece inseguro. Compartilhe um endereço direto e confiável.' };
  bucket.push({ at: now, content: normalized });
  buckets.set(key, bucket);
  return { allowed: true };
}

function allowAuth(key, limit, windowMs, now = Date.now()) {
  const bucket = authBuckets.get(key) || [];
  prune(bucket, windowMs, now);
  if (bucket.length >= limit) return false;
  bucket.push({ at: now }); authBuckets.set(key, bucket);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now - bucket.at(-1).at > 90000) buckets.delete(key);
  for (const [key, bucket] of authBuckets) if (now - bucket.at(-1).at > 3600000) authBuckets.delete(key);
}, 60000).unref();

module.exports = { suspiciousLink, allowMessage, allowAuth };
