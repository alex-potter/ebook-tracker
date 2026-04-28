/* eslint-disable @typescript-eslint/no-var-requires */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'icon.svg');
const OUT = path.join(ROOT, 'public', 'icons');
const MANIFEST = path.join(ROOT, 'public', 'manifest.json');
const META = path.join(ROOT, 'public', '_pwa-meta.html');

if (!fs.existsSync(SRC)) {
  console.error('Missing public/icon.svg — cannot generate PWA assets.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const args = [
  'npx',
  'pwa-asset-generator',
  `"${SRC}"`,
  `"${OUT}"`,
  `--manifest "${MANIFEST}"`,
  `--index "${META}"`,
  '--icon-only false',
  '--favicon',
  '--mstile',
  '--padding "10%"',
  '--background "#09090b"',
  '--opaque true',
  '--type png',
  '--quality 90',
  '--path "/icons"',
  '--path-override "/icons"',
];

execSync(args.join(' '), { stdio: 'inherit', cwd: ROOT });
console.log('\nPWA assets regenerated to public/icons/.');
console.log('If new <link> tags appeared in public/_pwa-meta.html, copy them into app/layout.tsx <head>.');
