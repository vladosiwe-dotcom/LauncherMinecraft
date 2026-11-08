import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { RiftAccountApi, RiftAccountError, ensureLinked, type RiftAccount } from '../core/riftaccount.js';

/**
 * Main-process side of Spell and Iron Rift accounts: sign-in state, the session token kept between launches
 * (encrypted with the OS keychain like the Microsoft token), and the IPC the UI uses.
 */
export interface AccountDeps {
  apiBase: string;
  allowInsecureLocal: boolean;
  userData: string;
  handle: <T>(channel: string, fn: (...args: any[]) => Promise<T>) => void;
  send: (channel: string, payload: unknown) => void;
  log: (line: string) => Promise<void>;
}

export class AccountService {
  private token: string | null = null;
  account: RiftAccount | null = null;
  private readonly api: RiftAccountApi | null;

  constructor(private readonly d: AccountDeps) {
    let api: RiftAccountApi | null = null;
    try { api = new RiftAccountApi(d.apiBase, d.allowInsecureLocal); } catch (e) { void d.log(`accounts disabled: ${(e as Error).message}`); }
    this.api = api;
  }

  private vault() { return join(this.d.userData, 'rift-account.bin'); }

  private async save(token: string | null) {
    this.token = token;
    if (!token) { await fs.rm(this.vault(), { force: true }); return; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable; refusing to store the session in plain text');
    await fs.writeFile(this.vault(), safeStorage.encryptString(token));
  }

  private need(): RiftAccountApi {
    if (!this.api) throw new RiftAccountError('accounts_unavailable', 0);
    return this.api;
  }

  private publish() { this.d.send('account:changed', this.account); }

  /** On start: continue the saved session (rotating the token). Offline keeps the account until it can be checked. */
  async restore(): Promise<void> {
    if (!this.api) return;
    let saved: string | null = null;
    try { saved = safeStorage.decryptString(await fs.readFile(this.vault())); } catch { return; }
    try {
      const r = await this.api.refresh(saved);
      await this.save(r.token);
      this.account = r.account;
    } catch (e) {
      if (e instanceof RiftAccountError && e.status === 401) { await this.save(null); this.account = null; }
      else { this.token = saved; await this.d.log(`account restore postponed: ${(e as Error).message}`); }
    }
  }

  /** Before playing: a signed-in, active account linked to the Minecraft profile that is about to play. */
  async readyToPlay(mc: { name: string; uuid: string; accessToken: string }): Promise<RiftAccount> {
    const api = this.need();
    if (!this.token) throw new RiftAccountError('account_required', 401);
    const { account } = await api.me(this.token).catch(async (e) => {
      if (e instanceof RiftAccountError && e.status === 401) { await this.save(null); this.account = null; this.publish(); }
      throw e;
    });
    if (account.mustChangePassword) throw new RiftAccountError('password_change_required', 403);
    this.account = await ensureLinked(api, this.token, account, mc);
    this.publish();
    return this.account;
  }

  register() {
    this.d.handle('account:state', async () => ({ account: this.account, available: !!this.api }));
    this.d.handle('account:register', async (nick: string, password: string) => {
      const r = await this.need().register(String(nick ?? ''), String(password ?? ''));
      await this.save(r.token); this.account = r.account; this.publish();
      return r.account;
    });
    this.d.handle('account:login', async (nick: string, password: string) => {
      const r = await this.need().login(String(nick ?? ''), String(password ?? ''));
      await this.save(r.token); this.account = r.account; this.publish();
      return r.account;
    });
    this.d.handle('account:logout', async () => {
      if (this.token) await this.need().logout(this.token).catch(() => undefined);
      await this.save(null); this.account = null; this.publish();
      return true;
    });
    this.d.handle('account:password', async (current: string, next: string) => {
      if (!this.token) throw new RiftAccountError('account_required', 401);
      await this.need().changePassword(this.token, String(current ?? ''), String(next ?? ''));
      this.account = (await this.need().me(this.token)).account; this.publish();
      return this.account;
    });
  }
}
