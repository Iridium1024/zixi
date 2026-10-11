import { readFileSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (file) => readFileSync(path.join(root, file), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const version = pkg.version
const versions = [lock.version, lock.packages[''].version,
  JSON.parse(read('src-tauri/tauri.conf.json')).version,
  read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1],
  read('src-tauri/Cargo.lock').match(/name = "zixi"\r?\nversion = "([^"]+)"/)?.[1]]
if (!/^\d+\.\d+\.\d+$/.test(version) || versions.some((v) => v !== version)) {
  throw new Error('Application version mismatch across manifests and lockfiles')
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error('Git tag does not match application version')
}
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))]
  .filter((file) => existsSync(path.join(root, file))).sort()
const failures = []
const manifest = []
for (const file of files) {
  const full = path.join(root, file)
  const stat = lstatSync(full)
  if (!stat.isFile() || stat.isSymbolicLink()) { failures.push(`${file}: not a regular file`); continue }
  if (/(^|\/)(node_modules|target|dist|\.workbuddy)(\/|$)|^(release-assets|releases|doc)\/|^docs\/local\//i.test(file) ||
      /\.(exe|dll|msi|zip|7z|db|sqlite|sqlite3|db-wal|db-shm|log|pfx|p12|key)$/i.test(file) ||
      /(^|\/)\.env($|\.)/i.test(file) && !file.endsWith('.env.example')) {
    failures.push(`${file}: generated, local or sensitive file`)
  }
  if (stat.size > 50 * 1024 * 1024) failures.push(`${file}: exceeds 50 MiB source limit`)
  const bytes = readFileSync(full)
  if (/\.(md|json|toml|lock|ya?ml|m?js|tsx?|rs|ps1|cmd|txt|html|css)$/i.test(file)) {
    const text = bytes.toString('utf8')
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/.test(text)) {
      failures.push(`${file}: potential private key or token (value suppressed)`)
    }
  }
  manifest.push({ path: file, bytes: stat.size, sha256: createHash('sha256').update(bytes).digest('hex') })
}
for (const required of ['README.md', 'LICENSE', 'package-lock.json', 'src-tauri/Cargo.lock',
  `.github/workflows/release.yml`, `docs/releases/v${version}.md`]) {
  if (!files.includes(required)) failures.push(`${required}: missing from upload candidates`)
}
if (failures.length) throw new Error(failures.join('\n'))
const output = path.join(root, 'docs/local/preflight', `v${version}-source-manifest.json`)
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify({ version, scope: 'Current source upload candidates; not a committed snapshot', files: manifest }, null, 2) + '\n')
console.log(`PASS: version ${version}; ${files.length} source upload candidates; no detected binaries, data files, private keys or tokens.`)
console.log(`Source manifest: ${output}`)
