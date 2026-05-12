/**
 * lib/crypto.ts
 *
 * Application-level AES-256-GCM encryption + HMAC-SHA-256 blind indexing.
 *
 * Wire format for encrypted fields (improvement #4 — key versioning)
 * ──────────────────────────────────────────────────────────────────
 *   [ 1-byte version ][ 12-byte random IV ][ N-byte ciphertext ][ 16-byte GCM auth tag ]
 *
 *   Version byte values:
 *     0x01  — current key, loaded from PII_ENCRYPTION_KEY
 *     0x02  — future rotation key, loaded from PII_ENCRYPTION_KEY_V2  (extend as needed)
 *
 *   Legacy ciphertext written before versioning was introduced (no leading
 *   version byte) is detected heuristically: if the first byte is NOT a
 *   recognised version tag (currently 0x01 or 0x02) we treat the entire
 *   buffer as the old unversioned format and decrypt with the current key.
 *   This ensures zero-downtime key introduction — old rows keep working
 *   until they are re-encrypted by a backfill job.
 *
 * Key rotation workflow
 * ─────────────────────
 *   1. Generate a new 32-byte key and put it in PII_ENCRYPTION_KEY_V2.
 *   2. Deploy: new writes go out with version byte 0x02.
 *      Old rows (0x01 or unversioned) continue to decrypt fine.
 *   3. Run the backfill script to re-encrypt old rows under the new key.
 *   4. Once all rows are v2, retire PII_ENCRYPTION_KEY and rename _V2 → _V1
 *      (or drop the old env var after the next deploy).
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
// Version tag constants
// ─────────────────────────────────────────────────────────────────────────────

const VERSION_BYTE_SIZE = 1
const VERSION_V1        = 0x01   // matches PII_ENCRYPTION_KEY
const VERSION_V2        = 0x02   // matches PII_ENCRYPTION_KEY_V2

/** The version tag written on every *new* ciphertext. Change when rotating. */
const CURRENT_VERSION = VERSION_V1

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

// Lazy singletons — keys are loaded once on first use.
let _keyV1: Buffer | null = null
let _keyV2: Buffer | null = null
let _blindKey: Buffer | null = null

function getKey(version: number): Buffer {
  switch (version) {
    case VERSION_V1:
      if (!_keyV1) _keyV1 = loadKey('PII_ENCRYPTION_KEY', 'AES-256-GCM encryption key v1')
      return _keyV1
    case VERSION_V2:
      if (!_keyV2) _keyV2 = loadKey('PII_ENCRYPTION_KEY_V2', 'AES-256-GCM encryption key v2')
      return _keyV2
    default:
      throw new Error(`[crypto] Unknown key version 0x${version.toString(16).padStart(2, '0')}`)
  }
}

function getBlindKey(): Buffer {
  if (!_blindKey) _blindKey = loadKey('PII_BLIND_INDEX_KEY', 'HMAC blind-index key')
  return _blindKey
}

// ─────────────────────────────────────────────────────────────────────────────
// BYTEA normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert whatever Supabase hands back for a BYTEA column into a Buffer.
 *
 * Supabase PostgREST serialises BYTEA as "\x<lowercase hex>".
 * This function accepts all three forms that can appear in practice.
 */
function normaliseBlob(blob: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(blob)) return blob
  if (blob instanceof Uint8Array) return Buffer.from(blob)

  const str = blob

  // 1. Supabase/Postgres hex prefix  \x...
  if (str.startsWith('\\x') || str.startsWith('\x5cx')) {
    const hexPart = str.slice(2)
    const decoded = Buffer.from(hexPart, 'hex')

    // Detect JSON-serialised Buffer objects written by an older code path
    const decodedStr = decoded.toString('utf8')
    if (decodedStr.includes('{"type":"Buffer","data":')) {
      try {
        const parsed = JSON.parse(decodedStr)
        return Buffer.from(parsed.data)
      } catch {
        return decoded
      }
    }
    return decoded
  }

  // 2. Raw stringified JSON Buffer (no \x prefix)
  if (str.startsWith('{"type":"Buffer"')) {
    try {
      const parsed = JSON.parse(str)
      return Buffer.from(parsed.data)
    } catch {
      // Fall through to base64
    }
  }

  // 3. Base64 fallback
  return Buffer.from(str, 'base64')
}

// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM helpers
// ─────────────────────────────────────────────────────────────────────────────

const IV_LENGTH  = 12  // 96-bit nonce — recommended for GCM
const TAG_LENGTH = 16  // 128-bit auth tag

/**
 * Returns true when the first byte of `buf` is a known version tag.
 * Used to distinguish new versioned ciphertexts from legacy ones.
 */
function isVersioned(buf: Buffer): boolean {
  return buf[0] === VERSION_V1 || buf[0] === VERSION_V2
}

/**
 * Encrypt a plaintext string using the current key version.
 *
 * Returns a Buffer:
 *   [ 1 B version ][ 12 B IV ][ N B ciphertext ][ 16 B GCM auth tag ]
 *
 * When inserted via the Supabase JS client into a BYTEA column the Buffer
 * is serialised correctly — no manual encoding needed.
 */
export function encrypt(plaintext: string): Buffer {
  const version = Buffer.alloc(VERSION_BYTE_SIZE)
  version[0]    = CURRENT_VERSION

  const iv     = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', getKey(CURRENT_VERSION), iv)
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()

  return Buffer.concat([version, iv, ct, tag])
}

/**
 * Decrypt a blob produced by `encrypt()` or by the pre-versioning code path.
 *
 * Dispatch:
 *   • First byte is a known version tag → versioned format; select key by version.
 *   • First byte is NOT a known version tag → legacy format; use current key.
 *
 * Accepts the raw Buffer, a Supabase "\x<hex>" string, or a base64 string.
 * Throws if the GCM auth tag fails (tampered or corrupted ciphertext).
 */
export function decrypt(cipherBlob: Buffer | Uint8Array | string): string {
  const buf = normaliseBlob(cipherBlob)

  // Minimum sizes:
  //   Versioned:  1 (ver) + 12 (IV) + 1 (ct≥1) + 16 (tag) = 30
  //   Legacy:     12 (IV) + 1 (ct≥1) + 16 (tag)            = 29
  if (buf.byteLength < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error(
      `[crypto] decrypt: blob is ${buf.byteLength} bytes — too short to be valid ciphertext`,
    )
  }

  let offset = 0
  let keyVersion = CURRENT_VERSION

  if (isVersioned(buf)) {
    keyVersion = buf[0]
    offset     = VERSION_BYTE_SIZE
  }
  // else: legacy unversioned blob — offset stays 0, use CURRENT_VERSION key

  const iv  = buf.subarray(offset, offset + IV_LENGTH)
  const tag = buf.subarray(buf.byteLength - TAG_LENGTH)
  const ct  = buf.subarray(offset + IV_LENGTH, buf.byteLength - TAG_LENGTH)

  const key     = getKey(keyVersion)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
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

// ─────────────────────────────────────────────────────────────────────────────
// Key-version utilities (used by backfill scripts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the version byte of an already-normalised ciphertext buffer,
 * or 0 for unversioned legacy blobs.
 * Useful in backfill scripts to skip already-migrated rows.
 */
export function ciphertextVersion(cipherBlob: Buffer | Uint8Array | string): number {
  const buf = normaliseBlob(cipherBlob)
  return isVersioned(buf) ? buf[0] : 0
}

/** The version tag that `encrypt()` currently writes. */
export const CURRENT_ENCRYPT_VERSION = CURRENT_VERSION
