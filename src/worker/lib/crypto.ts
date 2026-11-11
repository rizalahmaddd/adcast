const enc = new TextEncoder()

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
}

function pick(alphabet: string, length: number): string {
  // Rejection sampling keeps the distribution uniform for any alphabet size.
  const limit = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < length) {
    for (const x of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (x < limit && out.length < length) out += alphabet[x % alphabet.length]
    }
  }
  return out
}

export const newId = () => pick('0123456789abcdefghijklmnopqrstuvwxyz', 16)
export const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)))
export const newPairingCode = () => pick('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6)

export async function sha256(input: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(input)))
}

// Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2') return false
  const actual = await pbkdf2(password, fromB64url(salt), Number(iter))
  return timingSafeEqual(actual, fromB64url(hash))
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function newTotpSecret(): string {
  return pick(B32, 32)
}

function base32Decode(s: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

async function totpAt(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const msg = new DataView(new ArrayBuffer(8))
  msg.setUint32(4, counter)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg.buffer))
  const off = mac[19] & 0xf
  const bin =
    ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

export async function verifyTotp(secret: string, code: string, now = Date.now()): Promise<boolean> {
  const clean = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  const counter = Math.floor(now / 30_000)
  for (const drift of [0, -1, 1]) {
    const expected = await totpAt(secret, counter + drift)
    if (timingSafeEqual(enc.encode(expected), enc.encode(clean))) return true
  }
  return false
}

export { totpAt }
