const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'app', 'api');
const bakDir = path.join(root, '_api_bak');  // outside app/ so Next.js ignores it

fs.cpSync(apiDir, bakDir, { recursive: true });
fs.rmSync(apiDir, { recursive: true, force: true });
try {
  execSync('cross-env NEXT_PUBLIC_MOBILE=true next build', { stdio: 'inherit', cwd: root });
} finally {
  fs.cpSync(bakDir, apiDir, { recursive: true });
  fs.rmSync(bakDir, { recursive: true, force: true });
}
