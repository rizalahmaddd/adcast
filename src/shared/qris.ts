type Tlv = { tag: string; value: string }

function crc16(text: string): string {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function parse(payload: string): Tlv[] | null {
  const out: Tlv[] = []
  let at = 0
  while (at < payload.length) {
    const tag = payload.slice(at, at + 2)
    const length = Number(payload.slice(at + 2, at + 4))
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(length) || at + 4 + length > payload.length) return null
    out.push({ tag, value: payload.slice(at + 4, at + 4 + length) })
    at += 4 + length
  }
  return out
}

const field = ({ tag, value }: Tlv) => tag + String(value.length).padStart(2, '0') + value

function read(payload: string): Tlv[] | null {
  const text = payload.trim()
  const fields = parse(text)
  if (!fields || fields.at(-1)?.tag !== '63') return null
  return crc16(text.slice(0, -4)) === text.slice(-4).toUpperCase() ? fields : null
}

export const qrisMerchant = (payload: string): string | null => read(payload)?.find((f) => f.tag === '59')?.value ?? null

/**
 * Turns a merchant's static QRIS into one that carries a fixed amount, so the payer's app
 * fills in the total and the unique code can't be mistyped. Returns null for a payload that
 * isn't a valid QRIS string.
 */
export function qrisWithAmount(payload: string, amount: number): string | null {
  const fields = read(payload)
  if (!fields || !Number.isInteger(amount) || amount <= 0) return null
  const kept = fields
    .filter((f) => f.tag !== '54' && f.tag !== '63')
    // 12 marks the code as single-use with an amount; apps ignore tag 54 on a code marked 11.
    .map((f) => (f.tag === '01' ? { tag: '01', value: '12' } : f))
  const after = kept.findIndex((f) => Number(f.tag) > 54)
  kept.splice(after < 0 ? kept.length : after, 0, { tag: '54', value: String(amount) })
  const body = kept.map(field).join('') + '6304'
  return body + crc16(body)
}
