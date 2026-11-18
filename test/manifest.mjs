import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const manifest = JSON.parse(read('package.json'))

// The Loader installs this package through its bundle patch, so both halves
// have to stay declared and wired to files that exist.
assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch')
assert.equal(manifest.dsh?.client?.platform, 'web', 'dsh.client.platform')
assert.equal(manifest.exports?.['./client'], './client/client.js', 'exports ./client')
assert.equal(manifest.exports?.['./locale/*.json'], './locale/*.json', 'exports locale')

// DSH reads a plugin icon through the manifest path and inlines it below 256 KiB.
const icon = manifest.icon
assert.equal(typeof icon, 'string', 'manifest icon')
assert.ok(read(icon).length > 0, 'icon file')
assert.ok(statSync(new URL(icon, root)).size <= 256 * 1024, 'icon size limit')

// Display text comes from locale files, never from the package name.
for (const language of ['en', 'zh']) {
  const meta = JSON.parse(read(`locale/${language}.json`)).meta
  assert.equal(meta?.title, 'Workspace Model', `${language} meta.title`)
  assert.ok(meta.description.trim().length > 0, `${language} meta.description`)
}

// The patch mounts the Host half under the package's own name.
const patch = read('cordis.patch.yml')
assert.match(patch, /id:\s*workspace-model/, 'patch entry id')
assert.ok(patch.includes(`name: '${manifest.name}'`), 'patch entry name')

// The browser half must register under the package name the Loader resolves.
assert.ok(
  read('client/client.js').includes(`id: '${manifest.name}'`),
  'client bundle loader id',
)

console.log('MANIFEST PASS', { name: manifest.name, version: manifest.version })
