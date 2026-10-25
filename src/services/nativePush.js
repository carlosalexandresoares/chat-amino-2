const http2 = require('node:http2');
const crypto = require('node:crypto');
const admin = require('firebase-admin');
const prisma = require('../database/prisma');

let firebase;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    firebase = admin.initializeApp({ credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
  } catch (error) { console.error('Configuração FCM inválida:', error.message); }
}
const appleConfig = {
  keyId: process.env.APNS_KEY_ID, teamId: process.env.APNS_TEAM_ID,
  privateKey: process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  bundleId: process.env.APNS_BUNDLE_ID,
};
const appleAvailable = Object.values(appleConfig).every(Boolean);
const available = { android: Boolean(firebase), ios: appleAvailable };
const validToken = (platform, token) => platform === 'android'
  ? typeof token === 'string' && /^[A-Za-z0-9:._-]{40,512}$/.test(token)
  : platform === 'ios' && typeof token === 'string' && /^[a-fA-F0-9]{64,200}$/.test(token);

function appleJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: appleConfig.keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: appleConfig.teamId,
    iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: appleConfig.privateKey, dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${signingInput}.${signature}`;
}

async function sendApple(token, notification) {
  const host = process.env.APNS_ENV === 'sandbox'
    ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const client = http2.connect(host);
  return new Promise((resolve, reject) => {
    let status;
    let body = '';
    const request = client.request({ ':method': 'POST', ':path': `/3/device/${token}`,
      'apns-topic': appleConfig.bundleId, 'apns-push-type': 'alert',
      authorization: `bearer ${appleJwt()}`, 'content-type': 'application/json' });
    request.setEncoding('utf8');
    request.on('response', headers => { status = headers[':status']; });
    request.on('data', chunk => { body += chunk.slice(0, 1000); });
    request.on('end', () => { client.close();
      if (status === 200) resolve();
      else reject(Object.assign(new Error(`APNs ${status}: ${body}`), { statusCode: status }));
    });
    request.on('error', error => { client.close(); reject(error); });
    client.on('error', error => { client.close(); reject(error); });
    request.setTimeout(10000, () => request.destroy(new Error('APNs timeout')));
    request.end(JSON.stringify({ aps: { alert: { title: notification.title,
      body: notification.body }, sound: 'default' }, href: notification.href }));
  });
}

async function sendNativePush(notification, db = prisma, send = null) {
  if (!send && !available.android && !available.ios) return;
  const devices = await db.nativePushDevice.findMany({ where: { userId: notification.recipientId },
    take: 10, select: { id: true, platform: true, token: true } });
  await Promise.allSettled(devices.filter(device => send || available[device.platform]).map(async device => {
    try {
      if (send) await send(device, notification);
      else if (device.platform === 'android') await admin.messaging(firebase).send({
        token: device.token, notification: { title: notification.title, body: notification.body },
        data: { href: notification.href }, android: { priority: 'high' },
      });
      else await sendApple(device.token, notification);
    } catch (error) {
      const expired = error.code === 'messaging/registration-token-not-registered' ||
        (device.platform === 'ios' && [400, 410].includes(error.statusCode) &&
          /BadDeviceToken|Unregistered/.test(error.message));
      if (expired) await db.nativePushDevice.deleteMany({ where: { id: device.id } });
      else console.error('Falha ao enviar Push nativo:', error.code || error.message);
    }
  }));
}

module.exports = { available, validToken, sendNativePush };
