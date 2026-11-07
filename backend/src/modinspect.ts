import AdmZip from 'adm-zip';
import type { ModInfo } from './types.js';

/** Minimal TOML reader for NeoForge mods.toml files (tables, arrays of tables, strings, numbers, booleans, string arrays). */
export function parseToml(src: string): Record<string, any> {
  const root: Record<string, any> = {};
  let cur: Record<string, any> = root;
  const lines = src.replace(/\r/g, '').split('\n');
  const setPath = (path: string[], isArray: boolean) => {
    let o: any = root;
    for (let i = 0; i < path.length - 1; i++) { const k = path[i]!; o[k] ??= {}; o = Array.isArray(o[k]) ? o[k][o[k].length - 1] : o[k]; }
    const last = path[path.length - 1]!;
    if (isArray) { o[last] ??= []; const t = {}; o[last].push(t); return t; }
    o[last] ??= {}; return o[last];
  };
  const unquoteKey = (k: string) => k.trim().replace(/^"(.*)"$/, '$1');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    let m;
    if ((m = /^\[\[([^\]]+)\]\]/.exec(line))) { cur = setPath(m[1]!.split('.').map(unquoteKey), true); continue; }
    if ((m = /^\[([^\]]+)\]/.exec(line))) { cur = setPath(m[1]!.split('.').map(unquoteKey), false); continue; }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = unquoteKey(line.slice(0, eq));
    let raw = line.slice(eq + 1).trim();
    let value: any;
    if (raw.startsWith("'''") || raw.startsWith('"""')) {
      const q = raw.slice(0, 3); let body = raw.slice(3);
      while (!body.includes(q) && i + 1 < lines.length) body += '\n' + lines[++i];
      value = body.slice(0, body.indexOf(q)).replace(/^\n/, '');
    } else if (raw.startsWith('"')) {
      const end = raw.indexOf('"', 1); value = raw.slice(1, end).replace(/\\"/g, '"');
    } else if (raw.startsWith("'")) {
      value = raw.slice(1, raw.indexOf("'", 1));
    } else if (raw.startsWith('[')) {
      while (!raw.includes(']') && i + 1 < lines.length) raw += lines[++i];
      value = [...raw.matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]);
    } else {
      raw = raw.replace(/\s+#.*$/, '');
      value = raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw);
    }
    cur[key] = value;
  }
  return root;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/), pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0';
    const nx = Number(x), ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) { if (nx !== ny) return nx < ny ? -1 : 1; continue; }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Maven version range check, e.g. "[1.21.1,1.21.2)", "[21.1,)", "*", or a bare version (soft = any). */
export function inRange(version: string, range: string | undefined): boolean {
  if (!range || range === '*' || !/[[(]/.test(range)) return true;
  const parts = range.match(/[[(][^\])]*[\])]/g) ?? [];
  return parts.some((p) => {
    const lo = p[0] === '[', hi = p[p.length - 1] === ']';
    const [a, b] = p.slice(1, -1).split(',').map((s) => s?.trim());
    if (b === undefined) return compareVersions(version, a!) === 0; // [1.0]
    if (a && (lo ? compareVersions(version, a) < 0 : compareVersions(version, a) <= 0)) return false;
    if (b && (hi ? compareVersions(version, b) > 0 : compareVersions(version, b) >= 0)) return false;
    return true;
  });
}

export interface InspectResult { mod?: ModInfo; pack?: { format?: number; description?: string }; kind: 'mod' | 'resourcepack' | 'shaderpack' | 'config' | 'unknown'; errors: string[]; warnings: string[] }

/** Resource pack format for Minecraft 1.21.1. */
export const PACK_FORMAT_1_21_1 = 34;
export const MC = '1.21.1';

export function inspectArchive(buf: Buffer, fileName: string): InspectResult {
  const errors: string[] = [], warnings: string[] = [];
  const lower = fileName.toLowerCase();
  if (/\.(toml|json|json5|cfg|properties|txt|snbt)$/.test(lower)) return { kind: 'config', errors, warnings };
  let zip: AdmZip;
  try { zip = new AdmZip(buf); } catch { return { kind: 'unknown', errors: ['not_a_zip'], warnings }; }
  const entry = (n: string) => zip.getEntry(n);
  const text = (n: string) => entry(n)?.getData().toString('utf8');

  if (lower.endsWith('.jar')) {
    const neo = text('META-INF/neoforge.mods.toml');
    const legacy = text('META-INF/mods.toml');
    if (entry('fabric.mod.json')) return { kind: 'mod', errors: ['fabric_mod'], warnings, mod: { modId: '?', displayName: fileName, version: '?', loader: 'fabric', dependencies: [], clientOnlyHint: false } };
    if (entry('quilt.mod.json')) return { kind: 'mod', errors: ['quilt_mod'], warnings, mod: { modId: '?', displayName: fileName, version: '?', loader: 'quilt', dependencies: [], clientOnlyHint: false } };
    if (!neo) {
      return { kind: 'mod', errors: [legacy ? 'legacy_forge_mod' : 'no_mod_metadata'], warnings, mod: { modId: '?', displayName: fileName, version: '?', loader: legacy ? 'forge-legacy' : 'unknown', dependencies: [], clientOnlyHint: false } };
    }
    const t = parseToml(neo);
    const m = (t.mods ?? [])[0] ?? {};
    let version = String(m.version ?? '?');
    if (version.includes('${file.jarVersion}')) {
      const mf = text('META-INF/MANIFEST.MF') ?? '';
      version = /Implementation-Version:\s*(\S+)/.exec(mf)?.[1] ?? version;
    }
    const modId = String(m.modId ?? '?');
    const deps = ((t.dependencies ?? {})[modId] ?? []) as any[];
    const dependencies = deps.map((d) => ({
      modId: String(d.modId),
      type: (d.type ? String(d.type).toLowerCase() : d.mandatory === false ? 'optional' : 'required') as ModInfo['dependencies'][number]['type'],
      versionRange: String(d.versionRange ?? '*'),
      side: (String(d.side ?? 'BOTH').toUpperCase()) as 'BOTH' | 'CLIENT' | 'SERVER',
    }));
    const mcDep = dependencies.find((d) => d.modId === 'minecraft');
    const nfDep = dependencies.find((d) => d.modId === 'neoforge');
    if (mcDep && !inRange(MC, mcDep.versionRange)) errors.push(`minecraft_range:${mcDep.versionRange}`);
    if (!mcDep) warnings.push('no_minecraft_dependency');
    const display = String(m.displayTest ?? '');
    const info: ModInfo = {
      modId, displayName: String(m.displayName ?? modId), version, loader: 'neoforge',
      minecraftRange: mcDep?.versionRange, neoforgeRange: nfDep?.versionRange, dependencies,
      clientOnlyHint: display === 'IGNORE_ALL_VERSION' || /client/i.test(String(t.modLoader ?? '')) ,
    };
    return { kind: 'mod', mod: info, errors, warnings };
  }

  if (lower.endsWith('.zip')) {
    const mcmeta = text('pack.mcmeta');
    if (mcmeta) {
      try {
        const j = JSON.parse(mcmeta);
        const format = Number(j.pack?.pack_format);
        const sup = j.pack?.supported_formats;
        const supports = (f: number) => {
          if (Array.isArray(sup)) return f >= sup[0] && f <= sup[1];
          if (sup && typeof sup === 'object') return f >= sup.min_inclusive && f <= sup.max_inclusive;
          if (typeof sup === 'number') return f === sup;
          return format === f;
        };
        if (!supports(PACK_FORMAT_1_21_1)) warnings.push(`pack_format:${format}`);
        const description = typeof j.pack?.description === 'string' ? j.pack.description : JSON.stringify(j.pack?.description ?? '');
        return { kind: 'resourcepack', pack: { format, description }, errors, warnings };
      } catch { return { kind: 'resourcepack', errors: ['bad_pack_mcmeta'], warnings }; }
    }
    if (zip.getEntries().some((e) => e.entryName.startsWith('shaders/'))) return { kind: 'shaderpack', errors, warnings };
  }
  return { kind: 'unknown', errors, warnings: ['unknown_file_type'] };
}
