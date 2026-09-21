// Package-mode preview bundling (canon §5): vendor React globals + an iife DS
// bundle whose react imports resolve to those globals — the harness contract
// used by Claude Design previews (window.<GlobalName>, window.React/ReactDOM,
// stories built with the vendor React, components rendered by the same one).
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

/** Emit _vendor/react.js and _vendor/react-dom.js as browser globals, resolved
 *  from the PACKAGE's own react so vendor and bundle share one version. */
async function vendorReact({ pkgDir, out }) {
  const vendorDir = join(out, '_vendor')
  mkdirSync(vendorDir, { recursive: true })
  const common = { bundle: true, format: 'iife', minify: true, absWorkingDir: pkgDir, logLevel: 'silent' }
  await build({
    ...common,
    stdin: { contents: `export * from 'react'; import * as R from 'react'; export default R;`, resolveDir: pkgDir, loader: 'js' },
    globalName: 'React',
    outfile: join(vendorDir, 'react.js'),
  })
  await build({
    ...common,
    stdin: {
      contents: `export * from 'react-dom'; export { createRoot, hydrateRoot } from 'react-dom/client';`,
      resolveDir: pkgDir,
      loader: 'js',
    },
    globalName: 'ReactDOM',
    outfile: join(vendorDir, 'react-dom.js'),
  })
}

/** Bundle the package entry as an iife global. React imports are aliased to
 *  window globals via CJS shims — one React instance across stories and DS. */
export async function bundlePackage({ pkgDir, entry, globalName, out, meta = '' }) {
  await vendorReact({ pkgDir, out })

  const shimDir = join(out, '_shims')
  mkdirSync(shimDir, { recursive: true })
  const reactShim = join(shimDir, 'react.cjs')
  const domShim = join(shimDir, 'react-dom.cjs')
  const jsxShim = join(shimDir, 'jsx-runtime.cjs')
  writeFileSync(reactShim, 'module.exports = window.React;\n')
  writeFileSync(domShim, 'module.exports = window.ReactDOM;\n')
  // react-jsx transform imports jsx/jsxs/Fragment — serve them off the global.
  writeFileSync(
    jsxShim,
    'var R = window.React;\nmodule.exports = { Fragment: R.Fragment, jsx: (t,p,k)=>R.createElement(t, k===undefined?p:{...p,key:k}, ...(p&&p.children!==undefined?(Array.isArray(p.children)?p.children:[p.children]):[])), jsxs: null };\nmodule.exports.jsxs = module.exports.jsx;\n',
  )

  await build({
    entryPoints: [join(pkgDir, entry)],
    bundle: true,
    format: 'iife',
    globalName,
    minify: true,
    sourcemap: false,
    absWorkingDir: pkgDir,
    logLevel: 'silent',
    alias: {
      react: reactShim,
      'react-dom/client': domShim,
      'react-dom': domShim,
      'react/jsx-runtime': jsxShim,
      'react/jsx-dev-runtime': jsxShim,
    },
    banner: { js: `/* @ds-bundle: ${globalName}${meta ? ' ' + meta : ''} */` },
    outfile: join(out, '_ds_bundle.js'),
  })
  return { out: join(out, '_ds_bundle.js') }
}

/** Quality gate: load vendor + bundle + stylesheet in a real browser and mount
 *  a component before anything ships. Fails loudly on console errors, a missing
 *  global, or an unstyled render. */
export async function verifyBundle({ out, stylesheet, globalName, component = 'Button', childrenText = 'Test' }) {
  copyFileSync(stylesheet, join(out, '_verify_styles.css'))
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="_verify_styles.css">
<script src="_vendor/react.js"></script>
<script src="_vendor/react-dom.js"></script>
<script src="_ds_bundle.js"></script>
</head><body><div id="root"></div>
<script>
window.__result = (() => {
  try {
    if (!window.${globalName}) return 'missing global ${globalName}'
    const C = window.${globalName}['${component}']
    if (!C) return 'missing component ${component}'
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C, null, '${childrenText}'))
    return 'ok'
  } catch (e) { return 'error: ' + e.message }
})()
</script></body></html>`
  const page1 = join(out, '_verify.html')
  writeFileSync(page1, html)

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  await page.goto(pathToFileURL(page1).href)
  await page.waitForTimeout(400)
  const result = await page.evaluate('window.__result')
  const probe = await page.evaluate(() => {
    const el = document.querySelector('#root *')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { tag: el.tagName, text: el.textContent, background: cs.backgroundColor, font: cs.fontFamily.slice(0, 40) }
  })
  await browser.close()

  const failures = []
  if (result !== 'ok') failures.push(result)
  if (!probe) failures.push('nothing rendered inside #root')
  if (consoleErrors.length) failures.push(...consoleErrors.map((e) => 'console: ' + e))
  if (failures.length) {
    for (const f of failures) console.error('BUNDLE VERIFY FAIL', f)
    process.exit(1)
  }
  console.log(`bundle verify: ${globalName}.${component} mounted — <${probe.tag.toLowerCase()}> "${probe.text}" bg=${probe.background} font=${probe.font}`)
}
