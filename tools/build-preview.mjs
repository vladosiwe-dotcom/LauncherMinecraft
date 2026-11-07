// Builds a self-contained design preview (launcher, in-game menu concept, admin panel) into <out>.
// Usage: node tools/build-preview.mjs <out-dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'preview', 'dist');
mkdirSync(out, { recursive: true });
const read = (p) => readFileSync(join(root, p), 'utf8');
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+SC:wght@600;700&family=Press+Start+2P&family=Rubik:wght@400;500;700&display=swap">';

function inline(html, dir, extraHead = '') {
  return html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '')
    .replace('<link rel="stylesheet" href="fonts/fonts.css">', FONTS)
    .replace(/<link rel="stylesheet" href="([\w.-]+\.css)">/g, (_, f) => `<style>\n${read(join(dir, f))}\n</style>`)
    .replace(/<script src="([\w.-]+\.js)"><\/script>/g, (_, f) => `<script>\n${read(join(dir, f)).replace(/<\/script/g, '<\\/script')}\n</script>`)
    .replace('</head>', `${extraHead}</head>`);
}

writeFileSync(join(out, 'launcher.html'), inline(read('launcher/renderer/index.html'), 'launcher/renderer'));
writeFileSync(join(out, 'admin.html'), inline(read('backend/public/admin/index.html'), 'backend/public/admin', `${FONTS}<script>window.RIFT_FORCE_DEMO = true;</script>`));
writeFileSync(join(out, 'menu.html'), read('preview/menu.html'));
writeFileSync(join(out, 'index.html'), read('preview/index.html'));
console.log(`preview written to ${out}`);
