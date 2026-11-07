import type { GraphicsPresetId } from './manifest.js';

/** Values written into Minecraft's options.txt (only these keys; everything else stays the player's). */
export interface GraphicsPreset {
  id: GraphicsPresetId;
  shaders: boolean;
  /** Shader quality profile name passed to Iris shader options when shaders are on. */
  shaderProfile?: 'MEDIUM' | 'HIGH' | 'ULTRA';
  options: Record<string, string>;
}

export const GRAPHICS_PRESETS: Record<GraphicsPresetId, GraphicsPreset> = {
  minimal: {
    id: 'minimal', shaders: false,
    options: { renderDistance: '8', simulationDistance: '6', graphicsMode: '0', particles: '2', entityShadows: 'false', cloudStatus: '"false"', biomeBlendRadius: '0', mipmapLevels: '0', entityDistanceScaling: '0.75', maxFps: '120', ao: 'false' },
  },
  balanced: {
    id: 'balanced', shaders: false,
    options: { renderDistance: '12', simulationDistance: '8', graphicsMode: '1', particles: '1', entityShadows: 'true', cloudStatus: '"fast"', biomeBlendRadius: '2', mipmapLevels: '2', entityDistanceScaling: '1.0', maxFps: '144', ao: 'true' },
  },
  high: {
    id: 'high', shaders: true, shaderProfile: 'HIGH',
    options: { renderDistance: '16', simulationDistance: '10', graphicsMode: '1', particles: '0', entityShadows: 'true', cloudStatus: '"true"', biomeBlendRadius: '3', mipmapLevels: '4', entityDistanceScaling: '1.0', maxFps: '260', ao: 'true' },
  },
  ultra: {
    id: 'ultra', shaders: true, shaderProfile: 'ULTRA',
    options: { renderDistance: '24', simulationDistance: '12', graphicsMode: '1', particles: '0', entityShadows: 'true', cloudStatus: '"true"', biomeBlendRadius: '5', mipmapLevels: '4', entityDistanceScaling: '1.25', maxFps: '260', ao: 'true' },
  },
};

export interface HardwareInfo {
  cpuModel: string;
  cpuThreads: number;
  totalRamMb: number;
  gpuName?: string;
  gpuVendor?: 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';
  vramMb?: number;
  /** Highest OpenGL version reported by the GPU driver, e.g. 4.6. */
  glVersion?: number;
}

export interface PresetRecommendation { preset: GraphicsPresetId; reasons: string[] }

/** Conservative rules: never recommend shaders unless we positively know the GPU can take them. */
export function recommendPreset(hw: HardwareInfo): PresetRecommendation {
  const reasons: string[] = [];
  const ram = hw.totalRamMb;
  const vram = hw.vramMb ?? 0;
  const discrete = hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd' || (hw.gpuVendor === 'apple' && ram >= 16000);
  if (hw.glVersion !== undefined && hw.glVersion < 3.2) {
    reasons.push('gl<3.2');
    return { preset: 'minimal', reasons };
  }
  if (ram < 8000 || hw.cpuThreads < 4) { reasons.push('ram<8gb_or_cpu<4t'); return { preset: 'minimal', reasons }; }
  if (!discrete || vram < 3000) { reasons.push(discrete ? 'vram<3gb' : 'integrated_gpu'); return { preset: 'balanced', reasons }; }
  if (ram >= 16000 && vram >= 8000 && hw.cpuThreads >= 8) { reasons.push('high_end'); return { preset: 'ultra', reasons }; }
  reasons.push('mid_range_discrete');
  return { preset: 'high', reasons };
}

/** Recommended JVM heap for the client, in MB. */
export function recommendHeapMb(totalRamMb: number): number {
  if (totalRamMb <= 6000) return 3072;
  if (totalRamMb <= 8500) return 4096;
  if (totalRamMb <= 16500) return 6144;
  return 8192;
}

/** Merge preset keys into an options.txt body without touching other lines (keybinds etc.). */
export function applyOptions(optionsTxt: string, values: Record<string, string>): string {
  const lines = optionsTxt.split(/\r?\n/).filter((l, i, a) => !(l === '' && i === a.length - 1));
  const seen = new Set<string>();
  const out = lines.map((l) => {
    const idx = l.indexOf(':');
    if (idx < 0) return l;
    const key = l.slice(0, idx);
    if (key in values) { seen.add(key); return `${key}:${values[key]}`; }
    return l;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}:${v}`);
  return out.join('\n') + '\n';
}
