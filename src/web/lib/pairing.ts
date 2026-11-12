const PAIR_KEY = 'adcast_pair_code'

// A scanned QR opens /layar?pair=CODE. Keep the code in this tab until the dialog claims it,
// so a login redirect in between does not lose it.
export function capturePairCode() {
  const code = new URLSearchParams(location.search).get('pair')
  if (code && /^[a-z0-9]{6}$/i.test(code)) sessionStorage.setItem(PAIR_KEY, code.toUpperCase())
}

export function peekPairCode() {
  return sessionStorage.getItem(PAIR_KEY)
}

export function takePairCode() {
  const code = sessionStorage.getItem(PAIR_KEY)
  sessionStorage.removeItem(PAIR_KEY)
  return code
}
