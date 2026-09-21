// Visual regression gate (canon §3.6.5) — self-hosted, deterministic, no SaaS.
import { readFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, extname, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { compare } from 'odiff-bin'

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' }

/** odiff-bin's postinstall sometimes doesn't run (blocked npm scripts) leaving a
 *  placeholder bin — self-heal by copying the platform binary. */
function ensureOdiff() {
  const require = createRequire(import.meta.url)
  const pkgDir = dirname(require.resolve('odiff-bin/package.json'))
  const bin = join(pkgDir, 'bin', process.platform === 'win32' ? 'odiff.exe' : 'odiff')
  if (existsSync(bin) && statSync(bin).size > 10_000) return
  const raw = join(
    pkgDir,
    'raw_binaries',
    `odiff-${{ win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`,
  )
  copyFileSync(raw, bin)
  console.log('visual: self-healed odiff binary')
}

export async function visual({ dist, dir, viewport = { width: 1100, height: 800 }, update = false }) {
  ensureOdiff()
  const baseDir = join(dir, 'baseline')
  const curDir = join(dir, 'current')
  const diffDir = join(dir, 'diff')
  for (const d of [baseDir, curDir, diffDir]) mkdirSync(d, { recursive: true })

  const server = createServer((req, res) => {
    try {
      // The query is not part of the path. Reading the file already dropped
      // it; the content type did not, so `/x.html?y=1` produced the extension
      // `.html?y=1`, fell through to octet-stream, and the browser downloaded
      // the page instead of rendering it. Same input, one source of truth.
      const path = decodeURIComponent(req.url.split('?')[0])
      const body = readFileSync(join(dist, path))
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port

  const cards = JSON.parse(readFileSync(join(dist, '_ds_manifest.json'), 'utf8')).cards
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport })
  await page.route(/^(?!http:\/\/localhost)/, (route) => route.abort())
  await page.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  })

  let failed = 0
  let created = 0
  let ok = 0
  for (const card of cards) {
    const file = card.path.replace(/[\\/]/g, '__').replace(/\.html$/, '') + '.png'
    await page.goto(`http://localhost:${port}/${card.path}`, { waitUntil: 'load' })
    await page.waitForTimeout(150)
    const current = join(curDir, file)
    await page.screenshot({ path: current, fullPage: true })
    const baseline = join(baseDir, file)
    if (update || !existsSync(baseline)) {
      copyFileSync(current, baseline)
      created++
      continue
    }
    const result = await compare(baseline, current, join(diffDir, file), { threshold: 0.1, antialiasing: true })
    if (result.match) ok++
    else {
      failed++
      console.error(`DIFF ${card.path} (${result.reason}${result.diffPercentage ? ` ${result.diffPercentage.toFixed(2)}%` : ''})`)
    }
  }

  await browser.close()
  server.close()
  console.log(`visual gate: ${ok} ok, ${created} baselines ${update ? 'updated' : 'created'}, ${failed} diffs`)
  if (failed) process.exit(1)
}
