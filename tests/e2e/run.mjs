// Construit l'app, la sert, exécute les suites e2e, puis arrête tout —
// y compris si une suite échoue ou plante. Un serveur laissé en vie bloquerait
// le port au run suivant, et le message d'erreur ne dirait pas pourquoi.
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const PORT = 4399
const URL = `http://localhost:${PORT}/cockpit_app/`

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })
  if (r.status !== 0) process.exit(r.status || 1)
}

run('npx', ['vite', 'build'])

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
  detached: true,
})
const stop = () => {
  try {
    process.kill(-server.pid)
  } catch {
    /* déjà mort */
  }
}
process.on('exit', stop)
process.on('SIGINT', () => process.exit(130))

// Attendre que le serveur réponde vraiment : un `sleep` fixe est soit trop
// court sur une machine chargée, soit du temps perdu à chaque exécution.
let up = false
for (let i = 0; i < 60 && !up; i++) {
  try {
    const res = await fetch(URL)
    up = res.ok
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}
if (!up) {
  console.error(`Le serveur de prévisualisation n'a jamais répondu sur ${URL}`)
  process.exit(1)
}

let failed = 0
for (const f of readdirSync(here).filter((x) => x.endsWith('.e2e.mjs')).sort()) {
  console.log(`\n── ${f} ───────────────────────────────────────────`)
  const r = spawnSync('node', [join(here, f)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, E2E_URL: URL },
  })
  if (r.status !== 0) failed++
}
stop()
process.exit(failed ? 1 : 0)
