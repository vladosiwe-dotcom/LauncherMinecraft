import { Socket } from 'node:net';

/** Minecraft Server List Ping (protocol 1.7+): handshake + status request. */
export interface PingResult { online: boolean; players: number; maxPlayers: number; motd: string; version?: string; latencyMs?: number }

function varint(n: number): Buffer {
  const out: number[] = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function readVarint(buf: Buffer, off: number): [number, number] | null {
  let v = 0, shift = 0, i = off;
  while (i < buf.length) {
    const b = buf[i++]!; v |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [v, i];
    shift += 7; if (shift > 35) throw new Error('varint too long');
  }
  return null;
}
const packet = (id: number, ...parts: Buffer[]) => { const body = Buffer.concat([varint(id), ...parts]); return Buffer.concat([varint(body.length), body]); };
const str = (s: string) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); };

function flatten(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!c || typeof c !== 'object') return '';
  const o = c as { text?: string; extra?: unknown[] };
  return (o.text ?? '') + (o.extra ?? []).map(flatten).join('');
}

export function ping(host: string, port: number, timeoutMs = 4000): Promise<PingResult> {
  return new Promise((resolve) => {
    const sock = new Socket();
    let buf = Buffer.alloc(0);
    const started = Date.now();
    const done = (r: PingResult) => { sock.destroy(); resolve(r); };
    const fail = () => done({ online: false, players: 0, maxPlayers: 0, motd: '' });
    sock.setTimeout(timeoutMs, fail);
    sock.once('error', fail);
    sock.connect(port, host, () => {
      const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(port);
      sock.write(packet(0x00, varint(767), str(host), portBuf, varint(1))); // 767 = 1.21.1 protocol
      sock.write(packet(0x00));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const len = readVarint(buf, 0); if (!len) return;
        if (buf.length < len[1] + len[0]) return;
        const id = readVarint(buf, len[1]); if (!id || id[0] !== 0) return fail();
        const sl = readVarint(buf, id[1]); if (!sl) return;
        const json = JSON.parse(buf.subarray(sl[1], sl[1] + sl[0]).toString('utf8'));
        done({ online: true, players: json.players?.online ?? 0, maxPlayers: json.players?.max ?? 0, motd: flatten(json.description), version: json.version?.name, latencyMs: Date.now() - started });
      } catch { fail(); }
    });
  });
}
