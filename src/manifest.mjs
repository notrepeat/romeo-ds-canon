// Manifest emission (canon §3.6): the machine-readable card index built from
// every preview's first-line @dsCard marker.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, basename, sep } from 'node:path'

export function buildManifest({ dist, groupsOrder = [], namespace }) {
  const cards = []
  function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.html')) {
        const first = readFileSync(p, 'utf8').split('\n')[0]
        const g = /group="([^"]+)"/.exec(first)
        const n = /name="([^"]+)"/.exec(first)
        if (g) {
          const rel = p.slice(dist.length + 1).split(sep).join('/')
          cards.push({ path: rel, group: g[1], name: n ? n[1] : basename(e.name, '.html') })
        }
      }
    }
  }
  walk(dist)
  cards.sort((a, b) => {
    const d = groupsOrder.indexOf(a.group) - groupsOrder.indexOf(b.group)
    return d !== 0 ? d : a.name.localeCompare(b.name)
  })
  const manifest = {
    namespace,
    components: [],
    startingPoints: [],
    cards,
    templates: [],
    hasThumbnailHtml: false,
    globalCssPaths: [],
    tokens: [],
    themes: [],
    fonts: [],
    brandFonts: [],
    source: 'spa',
  }
  writeFileSync(join(dist, '_ds_manifest.json'), JSON.stringify(manifest, null, 2))
  return { count: cards.length, groups: [...new Set(cards.map((c) => c.group))] }
}
