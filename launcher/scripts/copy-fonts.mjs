// Copies the bundled web fonts into renderer/fonts so the launcher works offline.
import { cpSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
// fileURLToPath, not URL.pathname: on Windows pathname gives "/D:/..." and the build fails
const out = fileURLToPath(new URL('../renderer/fonts/', import.meta.url));
mkdirSync(out, { recursive: true });
const faces = [
  ['@fontsource/cormorant-sc', 'Cormorant SC', [600, 700]],
  ['@fontsource/rubik', 'Rubik', [400, 500, 700]],
  ['@fontsource/press-start-2p', 'Press Start 2P', [400]],
];
let css = '';
for (const [pkg, family, weights] of faces) {
  let dir;
  try { dir = dirname(require.resolve(`${pkg}/package.json`)); } catch { console.warn(`[fonts] ${pkg} not installed, using fallback fonts`); continue; }
  for (const w of weights) for (const subset of ['latin', 'cyrillic']) {
    const file = `${pkg.split('/')[1]}-${subset}-${w}-normal.woff2`;
    const src = join(dir, 'files', file);
    if (!existsSync(src)) continue;
    cpSync(src, join(out, file));
    css += `@font-face{font-family:'${family}';font-weight:${w};font-style:normal;font-display:swap;src:url(./${file}) format('woff2');}\n`;
  }
}
writeFileSync(join(out, 'fonts.css'), css);
