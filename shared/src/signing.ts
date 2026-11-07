import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, createHash } from 'node:crypto';
import { canonicalJson, type BuildManifest, type SignedManifest } from './manifest.js';

export function generateSigningKeys(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function keyIdOf(publicPem: string): string {
  return createHash('sha256').update(publicPem.trim()).digest('hex').slice(0, 16);
}

export function signManifest(manifest: BuildManifest, privatePem: string, publicPem: string): SignedManifest {
  const sig = sign(null, Buffer.from(canonicalJson(manifest)), createPrivateKey(privatePem));
  return { manifest, signature: sig.toString('base64'), keyId: keyIdOf(publicPem) };
}

/** Verify against any of the trusted public keys (supports key rotation). */
export function verifyManifest(signed: SignedManifest, trustedPublicPems: string[]): boolean {
  for (const pem of trustedPublicPems) {
    if (keyIdOf(pem) !== signed.keyId) continue;
    try {
      return verify(null, Buffer.from(canonicalJson(signed.manifest)), createPublicKey(pem), Buffer.from(signed.signature, 'base64'));
    } catch { return false; }
  }
  return false;
}
