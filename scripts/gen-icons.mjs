// Dependency-free PNG icon generator for the Cockpit PWA.
// Renders the brand mark (dark rounded field, gradient ring, center dot)
// procedurally and encodes to PNG with Node's built-in zlib.
// Run: node scripts/gen-icons.mjs   (outputs into public/icons/)
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

const BG = [11, 13, 18]      // #0b0d12
const A = [109, 124, 255]    // #6d7cff
const B = [168, 85, 247]     // #a855f7
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const c = size / 2
  const pad = maskable ? size * 0.14 : 0 // maskable safe area
  const R = (size - pad * 2) / 2
  const ringR = R * 0.58
  const ringW = R * 0.10
  const dotR = R * 0.255
  const corner = maskable ? -1 : size * 0.22 // rounded corners only for "any"
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // rounded-rect background mask
      let inField = true
      if (corner > 0) {
        const dx = Math.max(corner - x, x - (size - corner), 0)
        const dy = Math.max(corner - y, y - (size - corner), 0)
        if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > corner) inField = false
      }
      let col = BG
      let alpha = inField ? 255 : 0
      if (inField) {
        const d = Math.hypot(x - c, y - c)
        const t = Math.min(1, Math.max(0, (x + y) / (2 * size))) // diagonal gradient
        const grad = lerp(A, B, t)
        if (Math.abs(d - ringR) <= ringW) col = grad
        else if (d <= dotR) col = grad
      }
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = alpha
    }
  }
  return encodePNG(size, size, px)
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0)
  return Buffer.concat([len, t, data, crc])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

writeFileSync(join(OUT, 'icon-192.png'), render(192))
writeFileSync(join(OUT, 'icon-512.png'), render(512))
writeFileSync(join(OUT, 'icon-maskable-512.png'), render(512, { maskable: true }))
console.log('icons written to', OUT)
