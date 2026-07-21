import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages project site is served from /<repo>/.
// The repo is `cockpit_app`, so the base is /cockpit_app/.
// Override with VITE_BASE at build time if you deploy elsewhere
// (e.g. VITE_BASE=/ for a user/root site, or a custom domain).
const base = process.env.VITE_BASE || '/cockpit_app/'

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
})
