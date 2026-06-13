import { createHmac, createHash, randomBytes } from 'node:crypto';
import { hostname, platform } from 'node:os';

/**
 * Compute an HMAC-SHA256 over the concatenation of a previous hash and new data.
 *
 * This is designed for chained hashing (e.g. audit logs) where each entry
 * includes the hash of the previous entry, forming a tamper-evident chain.
 *
 * @param key      - The HMAC secret key.
 * @param prevHash - Hex-encoded hash of the previous entry in the chain.
 * @param data     - The data to authenticate.
 * @returns Hex-encoded HMAC-SHA256 digest.
 *
 * @example
 * ```ts
 * const key = generateKey();
 * const h1 = computeHmac(key, '0'.repeat(64), 'first entry');
 * const h2 = computeHmac(key, h1, 'second entry');
 * ```
 */
export function computeHmac(key: Buffer, prevHash: string, data: string): string {
  return createHmac('sha256', key)
    .update(prevHash)
    .update(data)
    .digest('hex');
}

/**
 * Compute a SHA-256 hash of the given string.
 *
 * @param input - The string to hash.
 * @returns Hex-encoded SHA-256 digest.
 *
 * @example
 * ```ts
 * const digest = hashString('hello world');
 * // => 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
 * ```
 */
export function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a cryptographically strong random 256-bit key.
 *
 * @returns A 32-byte `Buffer` suitable for use as an HMAC key.
 *
 * @example
 * ```ts
 * const key = generateKey();
 * console.log(key.length); // 32
 * ```
 */
export function generateKey(): Buffer {
  return randomBytes(32);
}

/**
 * Produce a short, deterministic hash that identifies this machine.
 *
 * Combines `os.hostname()` and `os.platform()` into a single SHA-256
 * digest and truncates to 16 hex characters. This is **not** a security
 * primitive — it is used for telemetry bucketing and log correlation.
 *
 * @returns A 16-character hex string derived from the machine identity.
 *
 * @example
 * ```ts
 * const id = machineIdHash();
 * console.log(id); // e.g. 'a3f8e2c10b4d7e91'
 * ```
 */
export function machineIdHash(): string {
  const raw = `${hostname()}${platform()}`;
  return hashString(raw).slice(0, 16);
}
