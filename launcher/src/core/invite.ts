/**
 * Invite code the owner sends to friends: the build server address, the game address and the build signing key
 * id. Pasted into a friend's launcher it sets both addresses and makes the first contact safe: the key the
 * server presents must match the id in the code, or the launcher refuses it.
 */
export interface Invite { api: string; game: string; keyId: string }

const PREFIX = 'RIFT-';

export function encodeInvite(i: Invite): string {
  return PREFIX + Buffer.from(JSON.stringify({ v: 1, a: i.api, g: i.game, k: i.keyId })).toString('base64url');
}

export function decodeInvite(code: string): Invite {
  const c = code.trim();
  if (!c.startsWith(PREFIX)) throw Object.assign(new Error('not an invite code'), { code: 'invite_bad' });
  let j: { v?: number; a?: string; g?: string; k?: string };
  try { j = JSON.parse(Buffer.from(c.slice(PREFIX.length), 'base64url').toString('utf8')); } catch { throw Object.assign(new Error('broken invite code'), { code: 'invite_bad' }); }
  const api = String(j.a ?? ''), game = String(j.g ?? ''), keyId = String(j.k ?? '');
  if (j.v !== 1 || !/^https:\/\/[^\s/]+\/?$/.test(api) || !/^[0-9a-f]{16}$/.test(keyId) || (game && !/^[A-Za-z0-9.-]+(:\d{2,5})?$/.test(game))) {
    throw Object.assign(new Error('broken invite code'), { code: 'invite_bad' });
  }
  return { api: api.replace(/\/$/, ''), game, keyId };
}
