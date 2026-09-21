// Package-mode contract extraction (canon §5, package mode): slice per-component
// .d.ts files out of a library's BUNDLED declaration file (tsup/dts output — all
// types already resolved in one file). Anti-drift by construction: the published
// contract is derived from the compiled source of truth, never hand-written.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Project } from 'ts-morph'

/** Collect every top-level declaration in the bundled d.ts, keyed by name. */
function indexDeclarations(source) {
  const decls = new Map()
  for (const stmt of source.getStatements()) {
    const kind = stmt.getKindName()
    if (['InterfaceDeclaration', 'TypeAliasDeclaration', 'EnumDeclaration', 'ClassDeclaration', 'FunctionDeclaration'].includes(kind)) {
      const name = stmt.getName?.()
      if (name) {
        // Overloads: keep every statement for a name.
        const list = decls.get(name) ?? []
        list.push(stmt)
        decls.set(name, list)
      }
    } else if (kind === 'VariableStatement') {
      for (const d of stmt.getDeclarations()) decls.set(d.getName(), [stmt])
    }
  }
  return decls
}

/** Names referenced inside a declaration's text that are top-level declarations. */
function referencedNames(stmts, decls, selfName) {
  const found = new Set()
  for (const stmt of stmts) {
    stmt.forEachDescendant((node) => {
      if (node.getKindName() === 'Identifier') {
        const name = node.getText()
        if (name !== selfName && decls.has(name)) found.add(name)
      }
    })
  }
  return found
}

const ensureExport = (text) => (text.startsWith('export') ? text : `export ${text.startsWith('declare') ? text : `declare ${text}`}`)

/**
 * Extract per-component contract files from a bundled declaration file.
 * A component is any exported PascalCase name with a matching `<Name>Props`
 * declaration. Each emitted file carries the props interface, the component
 * declaration, and the transitive closure of referenced local types.
 */
export function extractContracts({ dtsPath, out, systemName, only }) {
  const project = new Project({ compilerOptions: { skipLibCheck: true } })
  const source = project.addSourceFileAtPath(dtsPath)
  const decls = indexDeclarations(source)

  const importLines = source
    .getImportDeclarations()
    .map((i) => i.getText())
    .join('\n')

  const components = []
  for (const name of decls.keys()) {
    if (!/^[A-Z]/.test(name)) continue
    if (!decls.has(`${name}Props`)) continue
    if (only && !only.includes(name)) continue
    components.push(name)
  }

  for (const name of components) {
    // Transitive closure of referenced top-level types (excluding other components'
    // declarations only when they are components themselves — shared types travel).
    const include = new Set([`${name}Props`, name])
    const queue = [`${name}Props`, name]
    while (queue.length) {
      const current = queue.pop()
      for (const ref of referencedNames(decls.get(current), decls, current)) {
        const isOtherComponent = components.includes(ref) || components.includes(ref.replace(/Props$/, ''))
        if (!include.has(ref) && !isOtherComponent) {
          include.add(ref)
          queue.push(ref)
        }
      }
    }

    // Emit in source order for stable, readable output.
    const parts = []
    for (const stmt of source.getStatements()) {
      const stmtName = stmt.getName?.() ?? stmt.getDeclarations?.()[0]?.getName()
      if (stmtName && include.has(stmtName)) parts.push(ensureExport(stmt.getText()))
    }

    const dir = join(out, 'components', 'general', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${name}.d.ts`),
      `${importLines ? importLines + '\n\n' : ''}/**\n * ${name} — ${systemName}. Extracted from the bundled declarations (source of truth).\n */\n${parts.join('\n\n')}\n`,
    )
  }
  return { components }
}
