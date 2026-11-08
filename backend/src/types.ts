import type { FileCategory, GraphicsPresetId, InstallMode, Side } from '@sir/shared';

export type Role = 'owner' | 'admin' | 'moderator';

export interface User { id: string; username: string; role: Role; passwordHash: string; createdAt: string; lastLoginAt?: string; disabled?: boolean }
export interface Session { tokenHash: string; userId: string; csrf: string; createdAt: number; expiresAt: number; ip: string }

export interface ModInfo {
  modId: string;
  displayName: string;
  version: string;
  loader: 'neoforge' | 'forge-legacy' | 'fabric' | 'quilt' | 'unknown';
  minecraftRange?: string;
  neoforgeRange?: string;
  dependencies: { modId: string; type: 'required' | 'optional' | 'incompatible' | 'discouraged'; versionRange: string; side: 'BOTH' | 'CLIENT' | 'SERVER' }[];
  clientOnlyHint: boolean;
}

export interface LibraryItem {
  id: string;
  sha256: string;
  size: number;
  fileName: string;
  category: FileCategory;
  name: string;
  version: string;
  uploadedAt: string;
  uploadedBy: string;
  mod?: ModInfo;
  pack?: { format?: number; description?: string };
  /** Problems found on upload; items with errors cannot be added to a build. */
  errors: string[];
  warnings: string[];
}

export interface BuildEntry {
  itemId: string;
  path: string;
  side: Side;
  required: boolean;
  mode: InstallMode;
  presets?: GraphicsPresetId[];
}

export type BuildStatus = 'draft' | 'testing' | 'published' | 'archived';

export interface Build {
  id: string;
  version: string;
  status: BuildStatus;
  neoforgeVersion: string;
  entries: BuildEntry[];
  resourcePacks: string[];
  changelog: { ru: string; uk: string; en: string };
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  publishedAt?: string;
  basedOn?: string;
}

export interface News { id: string; tag: 'update' | 'event' | 'maintenance' | 'news'; date: string; published: boolean; title: { ru: string; uk: string; en: string }; body: { ru: string; uk: string; en: string } }
export interface SiteSettings { motd: string; rules: { ru: string; uk: string; en: string }; maxPlayers: number; whitelist: boolean }
export interface AuditEntry { at: string; user: string; action: string; detail?: string }

/** A launcher release in Rift Control. Installers are library items; the published one is signed for launchers. */
export interface LauncherReleaseRecord {
  id: string; version: string; createdAt: string; createdBy: string; publishedAt?: string;
  notes: { ru: string; uk: string; en: string };
  files: Partial<Record<'win' | 'mac' | 'linux', string>>; // library item ids
}
