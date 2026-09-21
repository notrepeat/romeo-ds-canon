// Law gates (canon §3.6) — file-based checks, framework-agnostic.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Module specifiers: `from 'x'` (imports + re-exports), side-effect `import 'x'`,
// dynamic `import('x')` and `require('x')` — single or double quoted.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g

// CSS hex colors are exactly 3, 4, 6 or 8 digits. The lookbehind skips URL fragments —
// `href="#id"` (incl. xlink:href) and `url(#id)` — which are anchors, not colors.
const HEX_COLOR = /(?<!href\s*=\s*["']|url\(\s*["']?)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g

/** Every module specifier referenced by the source. Regex-based: comments and strings are not stripped. */
function importSpecifiers(src) {
  return [...src.matchAll(SPECIFIER)].map((m) => m[2])
}

/** Scan component implementations for law violations. Returns {errors, warnings}. */
export function checkLaws({ componentsDir, allowedImports = ['react', 'react-dom'], nativeElements = [], numericSpacingExempt = [], extensions = ['.jsx', '.tsx'] }) {
  const errors = []
  const warnings = []
  const files = []
  function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (extensions.some((x) => e.name.endsWith(x))) files.push(p)
    }
  }
  walk(componentsDir)

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const name = file.split(/[\\/]/).pop()
    const stem = name.replace(/\.[jt]sx?$/, '')

    const hex = src.match(HEX_COLOR)
    if (hex) errors.push(`${name}: raw hex banned in DS components (${hex.join(', ')}) — use tokens`)

    for (const spec of importSpecifiers(src)) {
      // Entries ending in '/' are prefixes (e.g. 'romeo-forms/' allows any subpath).
      const allowed =
        allowedImports.some((a) => (a.endsWith('/') ? spec.startsWith(a) : spec === a)) ||
        spec.startsWith('./') ||
        spec.startsWith('../')
      if (!allowed) {
        errors.push(`${name}: external runtime import '${spec}' banned — allowed: ${allowedImports.join(', ')} + relatives`)
      }
    }

    for (const { tag, exceptIn = [] } of nativeElements) {
      // Tag boundary (whitespace, '>' or '/') so <button> matches but <buttonGroup> does not.
      const opensTag = new RegExp('<' + tag.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&') + '[\\s>/]')
      if (opensTag.test(src) && !exceptIn.includes(stem)) {
        errors.push(`${name}: native <${tag}> banned outside ${exceptIn.join('/') || 'nowhere'}`)
      }
    }

    if (!numericSpacingExempt.includes(stem)) {
      const gaps = src.match(/gap:\s*\d+/g)
      if (gaps) warnings.push(`${name}: numeric inline gap (${gaps.join(', ')}) — verify it is captured-faithful, not new`)
    }
  }
  return { errors, warnings, filesChecked: files.length }
}

/** Framework-free law: the given dirs must contain ZERO framework imports. */
export function checkFrameworkFree({ dirs, frameworks = ['react', 'react-dom', '@angular/', 'vue', 'svelte'] }) {
  const errors = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) continue
      const src = readFileSync(join(dir, e.name), 'utf8')
      for (const spec of importSpecifiers(src)) {
        // 'x/' entries are prefixes; others match the package or its subpaths, never 'x-other'.
        if (frameworks.some((f) => (f.endsWith('/') ? spec.startsWith(f) : spec === f || spec.startsWith(`${f}/`)))) {
          errors.push(`${e.name}: framework import '${spec}' banned in a core — framework code lives only in leaf bindings`)
        }
      }
    }
  }
  return { errors }
}

/** Type gate: tsc --noEmit over the given project (contracts + *.test-d.ts). */
export function typegate(root) {
  const tsc = spawnSync('npx', ['tsc', '--noEmit', '-p', root], { cwd: root, shell: true, encoding: 'utf8' })
  return { ok: tsc.status === 0, output: tsc.stdout || tsc.stderr }
}

/** Run all gates and exit(1) on violations — the standard entry for build scripts. */
export function enforce({ laws, root, frameworkFree }) {
  const all = { errors: [], warnings: [] }
  if (laws) {
    const r = checkLaws(laws)
    all.errors.push(...r.errors)
    all.warnings.push(...r.warnings)
    all.filesChecked = r.filesChecked
  }
  if (frameworkFree) all.errors.push(...checkFrameworkFree(frameworkFree).errors)
  if (root && existsSync(join(root, 'node_modules'))) {
    const t = typegate(root)
    if (!t.ok) all.errors.push('type gate (tsc) failed:\n' + t.output)
    else console.log('type gate (tsc): ok')
  } else if (root) {
    all.warnings.push('type gate skipped — run npm install to enable tsc + expect-type')
  }
  for (const w of all.warnings) console.warn('WARN', w)
  if (all.errors.length) {
    for (const e of all.errors) console.error('LAW VIOLATION', e)
    process.exit(1)
  }
  console.log(`enforce: ${all.filesChecked ?? 0} components checked, 0 violations, ${all.warnings.length} advisories`)
}
