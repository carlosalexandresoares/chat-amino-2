const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const cloudinary = require('../../config/cloudinary');
const sharp = require('sharp');
const webmDuration = require('./webmDuration');

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_SECONDS = Math.max(10, Math.min(600, Number(process.env.CHAT_AUDIO_MAX_SECONDS) || 120));
const cloudinaryConfigured = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
const s3Configured = Boolean(process.env.CHAT_S3_BUCKET && process.env.CHAT_S3_ACCESS_KEY_ID && process.env.CHAT_S3_SECRET_ACCESS_KEY);
const bucket = process.env.CHAT_S3_BUCKET;
const s3 = s3Configured ? new S3Client({
  region: process.env.CHAT_S3_REGION || 'auto',
  ...(process.env.CHAT_S3_ENDPOINT ? { endpoint: process.env.CHAT_S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: { accessKeyId: process.env.CHAT_S3_ACCESS_KEY_ID, secretAccessKey: process.env.CHAT_S3_SECRET_ACCESS_KEY },
}) : null;
const localRoot = process.env.NODE_ENV !== 'production' && process.env.CHAT_STORAGE_DIR?.trim()
  ? path.resolve(process.cwd(), process.env.CHAT_STORAGE_DIR.trim()) : null;
const publicRoot = path.resolve(process.cwd(), 'public');
if (localRoot && (localRoot === publicRoot || localRoot.startsWith(publicRoot + path.sep))) {
  throw new Error('Os arquivos privados do chat não podem ficar dentro da pasta public.');
}
const configured = Boolean(cloudinaryConfigured || s3 || localRoot);

function problem(message, status = 400) { return Object.assign(new Error(message), { status }); }
function requireStorage() { if (!configured) throw problem('Configure o armazenamento de arquivos do chat no servidor.', 503); }
function localPath(key) {
  if (!/^chat\/(audio|sticker|wallpaper|direct_image)\/[a-zA-Z0-9_-]{1,64}\/[0-9a-f-]{36}\.(webm|ogg|wav|m4a|mp3|webp)$/.test(key)) {
    throw problem('Arquivo inválido.');
  }
  return path.join(localRoot, ...key.split('/'));
}
function cloudinaryAsset(key) {
  const match = /^cloudinary:(image|raw):(webp|webm|ogg|wav|m4a|mp3):(chat\/(?:audio|sticker|wallpaper|direct_image)\/[a-zA-Z0-9_-]{1,64}\/[0-9a-f-]{36}(?:\.(?:webm|ogg|wav|m4a|mp3))?)$/.exec(key);
  if (!match) throw problem('Arquivo inválido.');
  return { resourceType: match[1], format: match[2], publicId: match[3] };
}
async function uploadCloudinary(kind, ownerId, prepared) {
  const resourceType = kind === 'AUDIO' ? 'raw' : 'image';
  const publicId = `chat/${kind.toLowerCase()}/${ownerId}/${randomUUID()}${resourceType === 'raw' ? `.${prepared.extension}` : ''}`;
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: resourceType, type: 'authenticated', public_id: publicId,
      overwrite: false, unique_filename: false,
    }, (error, upload) => error ? reject(error) : resolve(upload));
    stream.on('error', reject);
    stream.end(prepared.buffer);
  });
  if (result.public_id !== publicId || result.bytes !== prepared.buffer.length) {
    await cloudinary.uploader.destroy(result.public_id, { resource_type: resourceType, type: 'authenticated' }).catch(() => {});
    throw problem('O armazenamento retornou um arquivo inesperado.', 502);
  }
  return `cloudinary:${resourceType}:${prepared.extension}:${publicId}`;
}
async function downloadCloudinary(key) {
  const asset = cloudinaryAsset(key);
  const url = new URL(cloudinary.url(asset.publicId, {
    resource_type: asset.resourceType, type: 'authenticated', secure: true, sign_url: true,
    ...(asset.resourceType === 'image' ? { format: asset.format } : {}),
  }));
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw problem('Endereço de mídia inválido.', 502);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw problem('Arquivo indisponível no armazenamento.', 502);
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_AUDIO_BYTES) throw problem('Arquivo maior que o limite permitido.', 502);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_AUDIO_BYTES) throw problem('Arquivo maior que o limite permitido.', 502);
  return data;
}

function audioMime(buffer) {
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'audio/webm';
  if (buffer.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  if (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

async function prepareAudio(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_AUDIO_BYTES) throw problem('Áudio inválido ou maior que 8 MB.');
  const mimeType = audioMime(buffer);
  if (!mimeType) throw problem('Formato de áudio não permitido.');
  let metadata;
  try {
    const { parseBuffer } = await import('music-metadata');
    metadata = await parseBuffer(buffer, { mimeType, size: buffer.length }, { duration: true, skipCovers: true });
  } catch { throw problem('Não foi possível validar o áudio enviado.'); }
  if (!metadata.format.hasAudio || metadata.format.hasVideo) throw problem('Envie somente áudio.');
  const timelineDuration = mimeType === 'audio/webm' ? webmDuration(buffer) : null;
  const metadataDuration = metadata.format.duration;
  const duration = mimeType === 'audio/webm'
    ? (Number.isFinite(timelineDuration) && Number.isFinite(metadataDuration)
      ? Math.max(timelineDuration, metadataDuration) : (timelineDuration ?? metadataDuration))
    : metadataDuration;
  if (!Number.isFinite(duration) || duration < 0.2) throw problem('Não foi possível determinar a duração do áudio.');
  if (duration > MAX_AUDIO_SECONDS) throw problem(`O áudio deve ter até ${MAX_AUDIO_SECONDS} segundos.`);
  return { buffer, mimeType, duration, extension: { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' }[mimeType] };
}

async function prepareImage(buffer, kind, crop = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw problem('Imagem inválida ou maior que 5 MB.');
  let info;
  try { info = await sharp(buffer, { limitInputPixels: 20_000_000 }).metadata(); }
  catch { throw problem('Não foi possível abrir a imagem.'); }
  if (!['png', 'jpeg', 'webp'].includes(info.format) || info.pages > 1) throw problem('Use uma imagem PNG, JPEG ou WebP estática.');
  const oriented = await sharp(buffer, { limitInputPixels: 20_000_000 }).rotate().toBuffer();
  info = await sharp(oriented).metadata();
  let pipeline = sharp(oriented, { limitInputPixels: 20_000_000 });
  if (kind === 'STICKER') {
    const size = Math.min(info.width, info.height);
    const x = Math.min(100, Math.max(0, Number(crop.x) || 50)) / 100;
    const y = Math.min(100, Math.max(0, Number(crop.y) || 50)) / 100;
    pipeline = pipeline.extract({ left: Math.round((info.width - size) * x), top: Math.round((info.height - size) * y), width: size, height: size })
      .resize(256, 256);
  } else pipeline = pipeline.resize({ width: 1600, height: 1200, fit: 'inside', withoutEnlargement: true });
  return { buffer: await pipeline.webp({ quality: kind === 'STICKER' ? 88 : 80 }).toBuffer(), mimeType: 'image/webp', extension: 'webp' };
}

async function put(kind, ownerId, roomId, prepared) {
  requireStorage();
  let key;
  if (cloudinaryConfigured) key = await uploadCloudinary(kind, ownerId, prepared);
  else if (s3) {
    key = `chat/${kind.toLowerCase()}/${ownerId}/${randomUUID()}.${prepared.extension}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: prepared.buffer, ContentType: prepared.mimeType, CacheControl: 'private, max-age=3600' }));
  } else {
    key = `chat/${kind.toLowerCase()}/${ownerId}/${randomUUID()}.${prepared.extension}`;
    const target = localPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, prepared.buffer, { flag: 'wx' });
  }
  return { key, kind, ownerId, roomId, mimeType: prepared.mimeType, size: prepared.buffer.length, duration: prepared.duration ?? null };
}
async function get(key) {
  requireStorage();
  if (key.startsWith('cloudinary:')) return downloadCloudinary(key);
  if (!s3) {
    if (!localRoot) throw problem('Arquivo local indisponível neste servidor.', 503);
    return fs.readFile(localPath(key));
  }
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
}
async function remove(key) {
  if (key.startsWith('cloudinary:')) {
    const asset = cloudinaryAsset(key);
    await cloudinary.uploader.destroy(asset.publicId, { resource_type: asset.resourceType, type: 'authenticated', invalidate: true });
  } else if (s3) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else if (localRoot) await fs.rm(localPath(key), { force: true });
}

async function cleanupOrphans(prisma) {
  if (!configured) return;
  const abandoned = await prisma.chatAsset.findMany({ where: {
    createdAt: { lt: new Date(Date.now() - 86400000) }, messages: { none: {} },
    sticker: { is: null }, appearances: { none: {} }, directMessages: { none: {} },
  }, take: 50, select: { id: true, key: true } });
  for (const asset of abandoned) {
    try {
      await remove(asset.key);
      await prisma.chatAsset.deleteMany({ where: { id: asset.id, messages: { none: {} },
        sticker: { is: null }, appearances: { none: {} }, directMessages: { none: {} } } });
    } catch (error) { console.error('Falha ao limpar arquivo abandonado:', error); }
  }
}

module.exports = { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_AUDIO_SECONDS, configured, audioMime, prepareAudio, prepareImage, put, get, remove, cleanupOrphans, problem };
