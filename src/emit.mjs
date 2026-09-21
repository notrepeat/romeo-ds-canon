// 4-artifact emission (canon §3): .jsx + .d.ts + .prompt.md + .html preview.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { componentPrompt } from './prompt.mjs'

/** Write one preview card. First line carries the @dsCard marker the manifest
 *  and the Design System pane index from. */
export function previewCard({ outDir, path, group, name, title, body, css, fontsHtml = '', extraCss = '' }) {
  const html = `<!-- @dsCard group="${group}" name="${name}" -->
<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ?? name}</title>
${fontsHtml}
<style>${css}</style>
<style>${extraCss}</style>
</head><body>
${body}
</body></html>`
  const file = join(outDir, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
  return path
}

/** Emit a component's 4 artifacts under components/general/<Name>/. */
export function emitComponent({ outDir, def, layer, group, systemName, css, fontsHtml, cellCss = '' }) {
  const dir = join(outDir, 'components', 'general', def.name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${def.name}.jsx`), def.jsx + '\n')
  writeFileSync(join(dir, `${def.name}.d.ts`), def.dts + '\n')
  writeFileSync(
    join(dir, `${def.name}.prompt.md`),
    componentPrompt({ name: def.name, layer, systemName, constraint: def.constraint, dts: def.dts, stories: def.stories }),
  )
  previewCard({
    outDir,
    path: `components/general/${def.name}/${def.name}.html`,
    group,
    name: def.name,
    title: `${def.name} — ${systemName}`,
    body: `
<div class="ds-wrap">
  <div class="ds-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:start">${def.preview}
  </div>
</div>`,
    css,
    fontsHtml,
    extraCss: cellCss,
  })
}
