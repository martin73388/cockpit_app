import '@testing-library/jest-dom/vitest'
import { webcrypto } from 'node:crypto'

// jsdom doesn't provide crypto.randomUUID; back it with Node's webcrypto.
if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto = webcrypto
}
