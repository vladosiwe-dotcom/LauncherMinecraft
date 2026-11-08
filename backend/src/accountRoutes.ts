import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { requirePerm } from './auth.js';
import { Accounts, publicAccount, serverKeyMatches, type Account, type AccountRole } from './accounts.js';
import type { User } from './types.js';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).then((r) => { if (!res.headersSent) res.json(r ?? { ok: true }); }).catch(next);
const bearer = (req: Request) => {
  const h = req.header('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
};

/** Launcher-facing API: register, sign in, keep the session, change password, link the Minecraft profile. */
export function accountRouter(accounts: Accounts): Router {
  const r = express.Router();
  r.use(express.json({ limit: '16kb' }));
  r.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  r.post('/register', wrap(async (req) => {
    const { nick, password } = req.body ?? {};
    const { account, token } = await accounts.register(String(nick ?? ''), String(password ?? ''), req.ip ?? '');
    return { token, account: publicAccount(account) };
  }));
  r.post('/login', wrap(async (req) => {
    const { nick, password } = req.body ?? {};
    const { account, token } = await accounts.login(String(nick ?? ''), String(password ?? ''), req.ip ?? '');
    return { token, account: publicAccount(account) };
  }));
  r.post('/refresh', wrap(async (req) => {
    const t = bearer(req);
    if (!t) throw Object.assign(new Error('session_expired'), { status: 401 });
    const { account, token } = await accounts.refresh(t, req.ip ?? '');
    return { token, account: publicAccount(account) };
  }));

  // everything below needs a valid session
  const authed = async (req: Request, res: Response, next: NextFunction) => {
    const a = await accounts.session(bearer(req)).catch(() => null);
    if (!a) return res.status(401).json({ error: 'session_expired' });
    res.locals.account = a;
    next();
  };
  const me = (res: Response) => res.locals.account as Account;

  r.post('/logout', authed, wrap(async (req) => { await accounts.logout(bearer(req)!); }));
  r.get('/me', authed, wrap(async (_req, res) => ({ account: publicAccount(me(res)) })));
  r.post('/password', authed, wrap(async (req, res) => {
    await accounts.changePassword(me(res), req.body?.current, String(req.body?.next ?? ''), bearer(req)!);
  }));
  r.post('/link/challenge', authed, wrap(async (_req, res) => ({ serverId: accounts.linkChallenge(me(res)) })));
  r.post('/link', authed, wrap(async (req, res) => ({ minecraft: await accounts.link(me(res), String(req.body?.minecraftName ?? '')) })));
  return r;
}

/** Game server API (the guard mod): who is this Mojang-verified player? Requires the server API key. */
export function serverApiRouter(accounts: Accounts, serverKey: string): Router {
  const r = express.Router();
  r.use((req, res, next) => {
    if (!serverKeyMatches(req.header('x-rift-server-key'), serverKey)) return res.status(401).json({ error: 'bad_server_key' });
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  r.get('/players/:uuid', wrap(async (req) => accounts.lookupMinecraft(req.params.uuid!)));
  return r;
}

/** Rift Control: list, roles, bans, password reset and deletion of player accounts. */
export function adminAccountRoutes(admin: Router, accounts: Accounts, audit: (u: User | undefined, action: string, detail?: string) => Promise<unknown>) {
  const who = (res: Response) => res.locals.user as User;
  admin.get('/accounts', requirePerm('accounts.view'), wrap(async () => accounts.list()));
  admin.post('/accounts/:id/role', requirePerm('accounts.manage'), wrap(async (req, res) => {
    const a = await accounts.setRole(req.params.id!, req.body?.role as AccountRole);
    await audit(who(res), 'account.role', `${a.nick} → ${a.role}`);
    return publicAccount(a);
  }));
  admin.post('/accounts/:id/ban', requirePerm('accounts.moderate'), wrap(async (req, res) => {
    const a = await accounts.ban(req.params.id!, String(req.body?.reason ?? ''), who(res).username);
    await audit(who(res), 'account.ban', `${a.nick}: ${a.banReason}`);
    return publicAccount(a);
  }));
  admin.post('/accounts/:id/unban', requirePerm('accounts.moderate'), wrap(async (req, res) => {
    const a = await accounts.unban(req.params.id!);
    await audit(who(res), 'account.unban', a.nick);
    return publicAccount(a);
  }));
  admin.post('/accounts/:id/reset-password', requirePerm('accounts.manage'), wrap(async (req, res) => {
    const { account, temporaryPassword } = await accounts.resetPassword(req.params.id!);
    await audit(who(res), 'account.reset_password', account.nick);
    return { account: publicAccount(account), temporaryPassword };
  }));
  admin.delete('/accounts/:id', requirePerm('accounts.manage'), wrap(async (req, res) => {
    await accounts.remove(req.params.id!);
    await audit(who(res), 'account.delete', req.params.id);
  }));
}
