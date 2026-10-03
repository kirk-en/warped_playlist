// Shrinks the year logos in src/assets to what the cards actually show.
// Run: node scripts/optimize-logos.mjs [year ...]
// With years given, only those logos are processed; without, all of them are. Pass just
// the new ones, since re-encoding an already-optimized logo only loses quality.
// Originals live in git history; each logo is rewritten as warped_tour_<year>_logo.webp.
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const dir = path.resolve('src/assets');
// A card's logo is at most ~390x110 CSS px; this box covers that at 2x density.
const MAX_W = 600;
const MAX_H = 300;

const files = (await readdir(dir)).filter((f) => /^warped_tour_\d{4}_logo\.(png|gif|avif|webp)$/i.test(f));
const only = new Set(process.argv.slice(2));
const byYear = new Map();
for (const f of files) {
  const year = f.match(/(\d{4})/)[1];
  if (only.size && !only.has(year)) continue;
  byYear.set(year, [...(byYear.get(year) ?? []), f]);
}

let before = 0;
let after = 0;
for (const [year, group] of [...byYear].sort()) {
  // If a year has several sources, start from the one with the most pixels.
  let best = null;
  for (const f of group) {
    const buf = await readFile(path.join(dir, f));
    const { width, height } = await sharp(buf).metadata();
    if (!best || width * height > best.pixels) best = { f, buf, pixels: width * height };
  }
  const out = `warped_tour_${year}_logo.webp`;
  const webp = await sharp(best.buf)
    .resize(MAX_W, MAX_H, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, alphaQuality: 85, effort: 6, smartSubsample: true })
    .toBuffer();
  const { width, height } = await sharp(webp).metadata();
  const orig = (await Promise.all(group.map((f) => readFile(path.join(dir, f))))).reduce((n, b) => n + b.length, 0);
  // Keep the original when re-encoding wouldn't actually save anything.
  if (webp.length >= orig) {
    before += orig;
    after += orig;
    console.log(`${year}: kept original (${(orig / 1024).toFixed(0)}KB)`);
    continue;
  }
  before += orig;
  after += webp.length;
  await writeFile(path.join(dir, out), webp);
  for (const f of group) if (f !== out) await unlink(path.join(dir, f));
  console.log(`${year}: ${(orig / 1024).toFixed(0)}KB -> ${(webp.length / 1024).toFixed(0)}KB  (${width}x${height})`);
}
console.log(`total: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`);
