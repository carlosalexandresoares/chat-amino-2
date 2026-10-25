const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('../node_modules/sharp');

const root = path.resolve(__dirname, 'android/app/src/main/res');
const mascot = path.resolve(__dirname, '../public/image/purp-mascot.png');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const background = '#160927';

async function icon(size, imageSize, round) {
  const backgroundSvg = round
    ? `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${background}"/></svg>`
    : `<svg width="${size}" height="${size}"><rect width="100%" height="100%" fill="${background}"/></svg>`;
  const logo = await sharp(mascot).resize(imageSize, imageSize).png().toBuffer();
  return sharp(Buffer.from(backgroundSvg)).composite([{ input: logo,
    left: Math.floor((size - imageSize) / 2), top: Math.floor((size - imageSize) / 2) }]).png().toBuffer();
}

async function main() {
  for (const [density, scale] of Object.entries(densities)) {
    const folder = path.join(root, `mipmap-${density}`);
    await fs.mkdir(folder, { recursive: true });
    const legacy = Math.round(48 * scale);
    const foreground = Math.round(108 * scale);
    await fs.writeFile(path.join(folder, 'ic_launcher.png'), await icon(legacy, Math.round(legacy * .82), false));
    await fs.writeFile(path.join(folder, 'ic_launcher_round.png'), await icon(legacy, Math.round(legacy * .72), true));
    const logo = await sharp(mascot).resize(Math.round(foreground * .58)).png().toBuffer();
    await sharp({ create: { width: foreground, height: foreground, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: logo, gravity: 'centre' }]).png()
      .toFile(path.join(folder, 'ic_launcher_foreground.png'));
  }
  const { data, info } = await sharp(mascot).resize(96, 96).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
  }
  const notificationFolder = path.join(root, 'drawable-nodpi');
  await fs.mkdir(notificationFolder, { recursive: true });
  await sharp(data, { raw: info }).png().toFile(path.join(notificationFolder, 'purp_notification.png'));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
