// Prepares launcher/.stage: a standalone copy of the launcher for electron-builder.
// In the npm workspace, Electron and @sir/shared live in the root node_modules, where electron-builder
// does not look; here they are installed locally and @sir/shared is packed as a real dependency.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(launcher, '..');
const stage = join(launcher, '.stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'vendor'), { recursive: true });

for (const dir of ['dist', 'renderer', 'config', 'assets']) cpSync(join(launcher, dir), join(stage, dir), { recursive: true });

// @sir/shared as a tarball, so npm installs a real folder (not a workspace link)
execSync(`npm pack --pack-destination "${join(stage, 'vendor')}"`, { cwd: join(root, 'shared'), stdio: 'inherit' });
const tgz = readdirSync(join(stage, 'vendor')).find((f) => f.endsWith('.tgz'));

const pkg = JSON.parse(readFileSync(join(launcher, 'package.json'), 'utf8'));
pkg.dependencies = { ...pkg.dependencies, '@sir/shared': `file:./vendor/${tgz}` };
pkg.devDependencies = { electron: pkg.build.electronVersion, 'electron-builder': pkg.devDependencies['electron-builder'] };
delete pkg.scripts;
pkg.build.files = ['dist/**', 'renderer/**', 'config/**', 'assets/**', 'package.json'];
writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2));
execSync('npm install --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });
console.log(`staged launcher in ${stage}`);
