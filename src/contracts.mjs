// Emits the shared async contracts into a DS dist (canon §3.5).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTRACTS_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'contracts', 'index.d.ts')

export function emitAsyncContracts({ outDir, systemNotes = '' }) {
  const dir = join(outDir, 'components', 'general', '_contracts')
  mkdirSync(dir, { recursive: true })
  let dts = readFileSync(CONTRACTS_SRC, 'utf8')
  if (systemNotes) dts = dts.replace(' */', ` *\n${systemNotes.split('\n').map((l) => ` * ${l}`.trimEnd()).join('\n')}\n */`)
  writeFileSync(join(dir, 'AsyncContracts.d.ts'), dts)
  writeFileSync(
    join(dir, 'AsyncContracts.prompt.md'),
    `AsyncContracts from the design system. Shared contract file — not a rendered component. Import types from \`components/general/_contracts/AsyncContracts.d.ts\` (source of truth: romeo-ds-canon/contracts).

Destructive, irreversible, or payment mutations are NEVER optimistic — blocking pending + explicit confirmation. No silent optimism: pending-optimistic UI is signaled with tokens, never rendered as settled.

## Types

\`\`\`ts
${dts.replace(/\/\*\*[\s\S]*?\*\/\n\n/, '').trim()}
\`\`\`

## Wiring pattern (the host's ONLY responsibility)

Data is prefetch, never render. For mutations use the framework core only — in React:
\`useActionState\` gives \`[error, submitAction, isPending]\`; \`useOptimistic\` auto-reverts
on settle or error (the setter MUST run inside an Action/transition). Reconciliation,
action queues, retries, and idempotency keys belong to the host's data layer.
${systemNotes ? `\n## System notes\n\n${systemNotes}\n` : ''}`,
  )
}
