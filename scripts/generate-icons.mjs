import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public', 'favicon.svg');
const output = path.join(root, 'public', 'icons');

await mkdir(output, { recursive: true });

await Promise.all([
  sharp(source).resize(192, 192).png().toFile(path.join(output, 'icon-192.png')),
  sharp(source).resize(512, 512).png().toFile(path.join(output, 'icon-512.png')),
  sharp(source)
    .resize(410, 410)
    .extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: '#0f766e',
    })
    .png()
    .toFile(path.join(output, 'icon-maskable-512.png')),
]);

console.log(`Generated PWA icons in ${path.relative(root, output)}`);
