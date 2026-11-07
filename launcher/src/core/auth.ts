import { fetchWithTimeout } from './http.js';

/**
 * Microsoft account sign-in for Minecraft: OAuth 2.0 device code flow
 * -> Xbox Live -> XSTS -> Minecraft services. The launcher never sees the user's password;
 * only the Microsoft refresh token is stored, encrypted by the OS (see TokenVault).
 */
const MS_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';

export interface DeviceCode { userCode: string; verificationUri: string; expiresIn: number; interval: number; deviceCode: string; message: string }
export interface MinecraftSession {
  accessToken: string;
  expiresAt: number;
  uuid: string;
  name: string;
  xuid: string;
  skin?: { url: string; variant: 'CLASSIC' | 'SLIM' };
  capes: { id: string; alias: string; state: string }[];
}

export class AuthError extends Error {
  constructor(readonly code: 'expired' | 'declined' | 'no_xbox' | 'child' | 'no_license' | 'region' | 'network' | 'unknown', msg?: string) { super(msg ?? code); }
}

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

export class MicrosoftAuth {
  constructor(private readonly clientId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(clientId) || /^0{8}-/.test(clientId)) throw new AuthError('unknown', 'Azure client id is not configured (launcher/config/app.json)');
  }

  async startDeviceCode(): Promise<DeviceCode> {
    const r = await postForm(`${MS_BASE}/devicecode`, { client_id: this.clientId, scope: SCOPE });
    if (r.status !== 200) throw new AuthError('unknown', String(r.json.error_description ?? r.status));
    return {
      userCode: String(r.json.user_code), verificationUri: String(r.json.verification_uri), expiresIn: Number(r.json.expires_in),
      interval: Number(r.json.interval ?? 5), deviceCode: String(r.json.device_code), message: String(r.json.message ?? ''),
    };
  }

  /** Poll until the user approves in the browser. Returns the Microsoft refresh token and access token. */
  async pollDeviceCode(dc: DeviceCode, signal?: AbortSignal): Promise<{ refreshToken: string; accessToken: string }> {
    const deadline = Date.now() + dc.expiresIn * 1000;
    let interval = dc.interval;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new AuthError('declined', 'cancelled');
      await new Promise((r) => setTimeout(r, interval * 1000));
      const r = await postForm(`${MS_BASE}/token`, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: this.clientId, device_code: dc.deviceCode });
      if (r.status === 200) return { refreshToken: String(r.json.refresh_token), accessToken: String(r.json.access_token) };
      const err = String(r.json.error);
      if (err === 'authorization_pending') continue;
      if (err === 'slow_down') { interval += 5; continue; }
      if (err === 'authorization_declined') throw new AuthError('declined');
      if (err === 'expired_token') throw new AuthError('expired');
      throw new AuthError('unknown', String(r.json.error_description ?? err));
    }
    throw new AuthError('expired');
  }

  async refresh(refreshToken: string): Promise<{ refreshToken: string; accessToken: string }> {
    const r = await postForm(`${MS_BASE}/token`, { grant_type: 'refresh_token', client_id: this.clientId, refresh_token: refreshToken, scope: SCOPE });
    if (r.status !== 200) throw new AuthError('expired', String(r.json.error_description ?? 'refresh failed'));
    return { refreshToken: String(r.json.refresh_token ?? refreshToken), accessToken: String(r.json.access_token) };
  }

  async minecraftLogin(msAccessToken: string): Promise<MinecraftSession> {
    const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
    });
    if (xbl.status !== 200) throw new AuthError('unknown', `Xbox Live ${xbl.status}`);
    const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.json.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    });
    if (xsts.status === 401) {
      const x = Number(xsts.json.XErr);
      if (x === 2148916233) throw new AuthError('no_xbox');
      if (x === 2148916238) throw new AuthError('child');
      if (x === 2148916235) throw new AuthError('region');
      throw new AuthError('unknown', `XSTS ${x}`);
    }
    const uhs = String(xsts.json.DisplayClaims?.xui?.[0]?.uhs ?? '');
    const xuid = String(xsts.json.DisplayClaims?.xui?.[0]?.xid ?? '');
    const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.json.Token}` });
    if (mc.status !== 200) throw new AuthError('unknown', `Minecraft services ${mc.status}`);
    const token = String(mc.json.access_token);
    const profile = await this.profile(token);
    return { ...profile, accessToken: token, expiresAt: Date.now() + Number(mc.json.expires_in ?? 86400) * 1000 - 60000, xuid };
  }

  async profile(mcToken: string): Promise<Omit<MinecraftSession, 'accessToken' | 'expiresAt' | 'xuid'>> {
    const res = await fetchWithTimeout('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${mcToken}` } });
    if (res.status === 404) throw new AuthError('no_license');
    if (!res.ok) throw new AuthError('unknown', `profile ${res.status}`);
    const p = (await res.json()) as { id: string; name: string; skins?: { url: string; variant: 'CLASSIC' | 'SLIM'; state: string }[]; capes?: { id: string; alias: string; state: string }[] };
    const active = p.skins?.find((s) => s.state === 'ACTIVE');
    return { uuid: p.id, name: p.name, skin: active ? { url: active.url, variant: active.variant } : undefined, capes: p.capes ?? [] };
  }

  /** Upload a 64x64 PNG skin through the official Minecraft services API. */
  static async uploadSkin(mcToken: string, png: Buffer, variant: 'classic' | 'slim'): Promise<void> {
    if (png.length > 24 * 1024 || png.subarray(1, 4).toString() !== 'PNG') throw new AuthError('unknown', 'Skin must be a PNG up to 24 KB');
    const form = new FormData();
    form.append('variant', variant);
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'skin.png');
    const res = await fetchWithTimeout('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: { Authorization: `Bearer ${mcToken}` }, body: form });
    if (!res.ok) throw new AuthError('unknown', `skin upload ${res.status}`);
  }
}
