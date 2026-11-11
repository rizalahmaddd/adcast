// Prints a VAPID key pair for Web Push: node scripts/gen-vapid.mjs
const b64url = (bytes) => Buffer.from(bytes).toString('base64url')

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey))
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)

console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${d}`)
