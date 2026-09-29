/**
 * Generates the iOS `apple-touch-startup-image` set.
 *
 * iOS does not derive a launch screen from the web manifest the way Android does, so without
 * these files an installed PWA shows a blank white screen on cold launch. Each image must match
 * a device's exact pixel resolution or iOS silently ignores it, hence the explicit device table.
 *
 * Run with: node scripts/generate-ios-splash.mjs
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const LOGO = resolve(here, '../src/assets/brand/logo.jpeg');
const OUT = resolve(here, '../public/splash');

const BG = '#faf6ef';
const GOLD = '#a07d16';
const INK = '#2f2a24';

/** [cssWidth, cssHeight, devicePixelRatio] for every device we want a launch image for. */
const DEVICES = [
  [320, 568, 2], [375, 667, 2], [414, 736, 3], [375, 812, 3],
  [414, 896, 2], [414, 896, 3], [390, 844, 3], [428, 926, 3],
  [393, 852, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3],
  [768, 1024, 2], [810, 1080, 2], [820, 1180, 2],
  [834, 1112, 2], [834, 1194, 2], [1024, 1366, 2],
];

/** Circular-cropped logo at the given pixel size, with a thin gold ring. */
async function logoDisc(size) {
  const r = size / 2;
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`
  );
  const disc = await sharp(LOGO)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const ringW = Math.max(2, Math.round(size * 0.022));
  const ring = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - ringW / 2}" ` +
    `fill="none" stroke="${GOLD}" stroke-opacity="0.85" stroke-width="${ringW}"/></svg>`
  );
  return sharp(disc).composite([{ input: ring }]).png().toBuffer();
}

async function render(cssW, cssH, dpr) {
  const w = cssW * dpr;
  const h = cssH * dpr;
  const minSide = Math.min(w, h);

  const discSize = Math.round(minSide * 0.34);
  const disc = await logoDisc(discSize);

  const nameSize = Math.round(minSide * 0.082);
  const tagSize = Math.round(minSide * 0.032);
  const discTop = Math.round(h / 2 - discSize * 0.82);
  const textTop = discTop + discSize + Math.round(minSide * 0.075);

  // Letter-spaced serif wordmark, mirroring the in-page splash.
  const text = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
       <text x="50%" y="${textTop}" text-anchor="middle" fill="${INK}"
             font-family="Georgia, 'Times New Roman', serif" font-size="${nameSize}"
             letter-spacing="${(nameSize * 0.06).toFixed(2)}">The Bathany</text>
       <text x="50%" y="${textTop + Math.round(nameSize * 1.25)}" text-anchor="middle" fill="${GOLD}"
             font-family="Helvetica, Arial, sans-serif" font-size="${tagSize}"
             letter-spacing="${(tagSize * 0.3).toFixed(2)}">BOTANICAL BATH RITUALS</text>
     </svg>`
  );

  await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([
      { input: disc, top: discTop, left: Math.round(w / 2 - discSize / 2) },
      { input: text, top: 0, left: 0 },
    ])
    // Palette quantisation keeps the whole set small; the artwork is flat colour plus one photo.
    .png({ compressionLevel: 9, palette: true, quality: 80, effort: 10 })
    .toFile(resolve(OUT, `splash-${w}x${h}.png`));

  return { w, h, cssW, cssH, dpr };
}

/** The <link> tags to paste into index.html, one per image, keyed by exact device media query. */
function linkTag({ w, h, cssW, cssH, dpr }, orientation) {
  const [mw, mh] = orientation === 'portrait' ? [cssW, cssH] : [cssH, cssW];
  return `  <link rel="apple-touch-startup-image" href="splash/splash-${w}x${h}.png" ` +
    `media="(device-width: ${mw}px) and (device-height: ${mh}px) and ` +
    `(-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})">`;
}

await mkdir(OUT, { recursive: true });

const tags = [];
for (const [cssW, cssH, dpr] of DEVICES) {
  const portrait = await render(cssW, cssH, dpr);
  const landscape = await render(cssH, cssW, dpr);
  tags.push(linkTag(portrait, 'portrait'), linkTag(landscape, 'landscape'));
}

// Written outside `public/` so it is never served as part of the site.
await writeFile(resolve(here, 'ios-splash-links.html'), tags.join('\n') + '\n', 'utf8');
console.log(`Generated ${DEVICES.length * 2} launch images in public/splash`);
