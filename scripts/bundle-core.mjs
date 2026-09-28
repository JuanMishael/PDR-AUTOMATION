// Shared by the scripts/test-*.mjs self-checks: main-process core modules use vite-style
// extensionless imports that plain node can't resolve, so we bundle them with the esbuild
// already installed under vite instead of teaching node a resolver.
//
// Output lands in node_modules/.pdr-test/ on purpose: playwright stays external (bundling it
// fails on chromium-bidi), so the bundle must sit somewhere node's resolver can still walk up
// and find node_modules from.
import { build } from 'esbuild'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'node_modules', '.pdr-test')

// Core modules that touch electron (db.js) can't be imported by plain node — the real electron
// package resolves to a path string, not the API. Swapped for a stub with just the bits these
// self-checks reach; anything else stays undefined and fails loudly rather than silently.
const electronStub = {
  name: 'electron-stub',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'electron-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
      contents: `import { join as __j } from 'node:path'; import { tmpdir as __t } from 'node:os'
      export const ipcMain = { handle() {}, on() {} }, shell = {}, dialog = {}
      export const app = {
        getPath: (n) => __j(__t(), 'pdr-test-' + n),
        getAppPath: () => process.cwd(),
        isPackaged: false
      }`,
      loader: 'js'
    }))
  }
}

export async function bundleCore(names) {
  await build({
    entryPoints: names.map(n => join(ROOT, 'src', 'main', 'core', n)),
    bundle: true, format: 'esm', platform: 'node', logLevel: 'warning',
    external: ['playwright', 'playwright/test', 'sql.js'],
    plugins: [electronStub],
    outdir: OUT, outExtension: { '.js': '.mjs' }
  })
  const mods = {}
  for (const n of names) {
    Object.assign(mods, await import(pathToFileURL(join(OUT, n.replace(/\.js$/, '.mjs'))).href))
  }
  return mods
}
