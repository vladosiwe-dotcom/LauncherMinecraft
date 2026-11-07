import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { generateSigningKeys, keyIdOf } from '@sir/shared';

/** Ed25519 manifest-signing key pair. The private key never leaves the server; the public key goes into the launcher config. */
export async function loadOrCreateKeys(dataDir: string): Promise<{ privatePem: string; publicPem: string; keyId: string }> {
  const dir = join(dataDir, 'keys');
  const priv = join(dir, 'manifest-ed25519.pem');
  const pub = join(dir, 'manifest-ed25519.pub.pem');
  if (!existsSync(priv)) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const k = generateSigningKeys();
    await fs.writeFile(priv, k.privatePem, { mode: 0o600 });
    await fs.writeFile(pub, k.publicPem);
  }
  const privatePem = await fs.readFile(priv, 'utf8');
  const publicPem = await fs.readFile(pub, 'utf8');
  return { privatePem, publicPem, keyId: keyIdOf(publicPem) };
}
