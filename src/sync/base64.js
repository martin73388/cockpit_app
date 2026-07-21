// UTF-8 <-> base64 that survives non-ASCII content (accents, emoji).
// Works in the browser (btoa/atob operate on binary strings) and in Node.
export function utf8ToBase64(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf-8').toString('base64')
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function base64ToUtf8(b64) {
  const clean = String(b64).replace(/\s/g, '') // GitHub wraps base64 with newlines
  if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf-8')
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
