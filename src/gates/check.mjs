// Law gates (canon §3.6) — file-based checks, framework-agnostic.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

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

    const hex = src.match(/#[0-9a-fA-F]{3,8}\b/g)
    if (hex) errors.push(`${name}: raw hex banned in DS components (${hex.join(', ')}) — use tokens`)

    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1]
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
      if (src.includes(`<${tag}`) && !exceptIn.includes(stem)) {
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
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        if (frameworks.some((f) => m[1] === f || m[1].startsWith(f))) {
          errors.push(`${e.name}: framework import '${m[1]}' banned in a core — framework code lives only in leaf bindings`)
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
