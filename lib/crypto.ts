/**
 * lib/crypto.ts
 *
 * Application-level AES-256-GCM encryption + HMAC-SHA-256 blind indexing.
 *
 * Wire format for encrypted fields:
 *   [ 12-byte random IV ][ N-byte ciphertext ][ 16-byte GCM auth tag ]
 *
 * IMPORTANT — Supabase BYTEA wire format:
 *   PostgREST returns BYTEA columns as a hex string prefixed with \x
 *   e.g.  "\x0a1b2cdeadbeef..."
 *   NOT as base64. The `normaliseBlob()` helper below handles all three
 *   possible forms a value can arrive in:
 *     1. Already a Buffer / Uint8Array  (server-to-server in the same process)
 *     2. "\x<hex>"  string             (Supabase PostgREST BYTEA — most common)
 *     3. base64 string                 (edge cases / manual testing)
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Key loading
// ─────────────────────────────────────────────────────────────────────────────

function loadKey(envVar: string, label: string): Buffer {
  const raw = process.env[envVar]
  if (!raw) throw new Error(`[crypto] Missing env var ${envVar} — ${label} is not configured`)

  // Accept 64-char hex (32 bytes) or base64-encoded 32 bytes
  const buf =
    raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64')

  if (buf.byteLength !== 32) {
    throw new Error(`[crypto] ${envVar} must decode to exactly 32 bytes (got ${buf.byteLength})`)
  }
  return buf
}

let _encKey: Buffer | null = null
let _blindKey: Buffer | null = null

function getEncKey(): Buffer {
  if (!_encKey) _encKey = loadKey('PII_ENCRYPTION_KEY', 'AES-256-GCM encryption key')
  return _encKey
}

function getBlindKey(): Buffer {
  if (!_blindKey) _blindKey = loadKey('PII_BLIND_INDEX_KEY', 'HMAC blind-index key')
  return _blindKey
}

// ─────────────────────────────────────────────────────────────────────────────
// BYTEA normalisation — THE fix for the [encrypted] bug
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert whatever Supabase hands back for a BYTEA column into a Buffer.
 *
 * Supabase PostgREST serialises BYTEA as "\x<lowercase hex>".
 * This function accepts all three forms that can appear in practice.
 */
function normaliseBlob(blob: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(blob)) return blob;
  if (blob instanceof Uint8Array) return Buffer.from(blob);

  let str = blob;

  // 1. Handle Supabase/Postgres Hex Prefix
  if (str.startsWith('\\x') || str.startsWith('\x5cx')) {
    const hexPart = str.slice(2);
    const decoded = Buffer.from(hexPart, 'hex');
    
    // Check if the decoded hex is actually a JSON stringified Buffer object
    const decodedStr = decoded.toString('utf8');
    if (decodedStr.includes('{"type":"Buffer","data":')) {
      try {
        const parsed = JSON.parse(decodedStr);
        return Buffer.from(parsed.data);
      } catch (e) {
        // Fallback if JSON parse fails
        console.warn('[crypto] normaliseBlob: Failed to parse decoded hex as JSON, returning raw decoded buffer');
        return decoded;
      }
    }
    return decoded;
  }
  // 2. Handle raw stringified JSON (without the \x)
  if (str.startsWith('{"type":"Buffer"')) {
    try {
      const parsed = JSON.parse(str);
      return Buffer.from(parsed.data);
    } catch (e) {
      console.warn('[crypto] normaliseBlob: Failed to parse string as JSON, treating as base64');
    }
  }

  // 3. Fallback: treat as base64
  return Buffer.from(str, 'base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM helpers
// ─────────────────────────────────────────────────────────────────────────────

const IV_LENGTH  = 12  // 96-bit nonce — recommended for GCM
const TAG_LENGTH = 16  // 128-bit auth tag

/**
 * Encrypt a plaintext string.
 * Returns a Buffer: [IV (12 B)][ciphertext (N B)][GCM auth tag (16 B)]
 *
 * When inserted via the Supabase JS client into a BYTEA column, the client
 * serialises the Buffer correctly — no manual encoding needed.
 */
export function encrypt(plaintext: string): Buffer {
  const iv     = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', getEncKey(), iv)
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag])
}

/**
 * Decrypt a blob produced by `encrypt()`.
 *
 * Accepts the raw Buffer, a Supabase "\x<hex>" string, or a base64 string.
 * Throws if the GCM auth tag fails (tampered or corrupted ciphertext).
 */
export function decrypt(cipherBlob: Buffer | Uint8Array | string): string {
  const buf = normaliseBlob(cipherBlob)

  if (buf.byteLength < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error(
      `[crypto] decrypt: blob is ${buf.byteLength} bytes — too short to be valid ciphertext`
    )
  }

  const iv  = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(buf.byteLength - TAG_LENGTH)
  const ct  = buf.subarray(IV_LENGTH, buf.byteLength - TAG_LENGTH)

  const key = getEncKey();

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([
      decipher.update(ct),
      decipher.final()
    ]);
  return decrypted.toString('utf8')
}

// ─────────────────────────────────────────────────────────────────────────────
// Blind index (deterministic HMAC-SHA-256)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produce a deterministic blind index for searchable PII fields.
 * Value is normalised (trimmed + lowercased) so "Alice" and "alice" collide.
 * Returns a hex string safe for a TEXT column with a B-tree index.
 */
export function blindIndex(value: string): string {
  const normalised = value.trim().toLowerCase()
  return createHmac('sha256', getBlindKey()).update(normalised, 'utf8').digest('hex')
}

/**
 * Constant-time comparison of two blind-index hex strings.
 * Prevents timing attacks when checking duplicates against stored hashes.
 */
export function safeCompareBlindIndex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

// ─────────────────────────────────────────────────────────────────────────────
// Nullable convenience wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function encryptIfPresent(value: string | null | undefined): Buffer | null {
  return value == null || value === '' ? null : encrypt(value)
}

export function decryptIfPresent(
  blob: Buffer | Uint8Array | string | null | undefined,
): string | null {
  return blob == null ? null : decrypt(blob)
}
