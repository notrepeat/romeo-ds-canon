# romeo-ds-canon

![version](https://img.shields.io/badge/version-0.1.0-blue)
![module](https://img.shields.io/badge/module-Node%20ESM-339933)
![status](https://img.shields.io/badge/status-experimental%20%28pre--1.0%29-orange)

Design-system rules as executable tooling instead of prose docs. `romeo-ds-canon` is a Node ESM library that emits a component's artifacts (implementation, type contract, AI prompt, HTML preview), derives prompts from the type contract so they cannot drift, indexes previews into a manifest, and enforces the house laws through file, type, and visual-regression gates. It is for teams that build design systems meant to be implemented by both people and AI agents: the library is aesthetic-agnostic (it never decides how things look), contract-first (the `.d.ts` is the source of truth), and keeps framework code confined to leaf bindings.

## Quick path

**1. Install** (not published to npm; install from GitHub or a local path):

```bash
npm install github:notrepeat/romeo-ds-canon
npx playwright install chromium   # required by the visual gate and verifyBundle
```

**2. Bind the canon to your system:**

```js
import { defineSystem } from 'romeo-ds-canon'

const system = defineSystem({
  out: 'dist',                       // emitted design-system output
  namespace: 'acme',                 // written into the manifest
  groupsOrder: ['Atoms', 'Molecules'],
  root: '.',                         // project for the tsc type gate
  visualDir: 'visual',               // baseline/current/diff screenshots
  laws: {
    allowedImports: ['react', 'react-dom', 'acme-forms/'],
    nativeElements: [{ tag: 'button', exceptIn: ['Button'] }],
  },
  frameworkFree: { dirs: ['src/core'] },
})
```

**3. Run the verbs:**

| Call | What it does | Returns |
|------|--------------|---------|
| `system.manifest()` | Indexes every preview card under `out` and writes `out/_ds_manifest.json` | `{ count, groups }` |
| `system.check()` | Runs the law, framework-free, and type gates; logs a summary | nothing; calls `process.exit(1)` on any violation |
| `await system.visual()` | Screenshots every manifest card and diffs against baselines | nothing; calls `process.exit(1)` on any diff |
| `await system.visual({ update: true })` | Overwrites all baselines with the current render | nothing |

Run `manifest()` before `visual()`: the visual gate reads the card list from `_ds_manifest.json`.

### `defineSystem(config)` keys

| Key | Used by | Meaning |
|-----|---------|---------|
| `out` | manifest, visual, check | Output directory of the emitted design system |
| `namespace` | manifest | Written to the manifest's `namespace` field |
| `groupsOrder` | manifest | Card group sort order (then by name) |
| `componentsDir` | check | Directory scanned by the law gate; defaults to `${out}/components` |
| `laws` | check | Extra options spread into `checkLaws` (see [The laws](#the-laws)) |
| `root` | check | Project root for the type gate; omit to skip it |
| `frameworkFree` | check | `{ dirs, frameworks? }` for the framework-free law; omit to skip it |
| `visualDir` | visual | Directory holding `baseline/`, `current/`, `diff/` |
| `viewport` | visual | Screenshot viewport; defaults to `{ width: 1100, height: 800 }` |

The returned object also exposes the original `config`.

## API

Every verb is a standalone function; `defineSystem` only binds three of them to one config.

| Export | Module | Description |
|--------|--------|-------------|
| `defineSystem(config)` | `src/index.mjs` | Returns `{ config, manifest, check, visual }` bound to one system |
| `emitComponent({ outDir, def, layer, group, systemName, css, fontsHtml, cellCss })` | `src/emit.mjs` | Writes the four artifacts to `components/general/<Name>/`: `.jsx`, `.d.ts`, `.prompt.md`, `.html`. `def` supplies `name`, `jsx`, `dts`, `constraint`, `stories`, `preview` |
| `previewCard({ outDir, path, group, name, title, body, css, fontsHtml, extraCss })` | `src/emit.mjs` | Writes one HTML preview whose first line is the `<!-- @dsCard group="..." name="..." -->` marker; returns `path` |
| `componentPrompt({ name, layer, systemName, constraint, dts, stories })` | `src/prompt.mjs` | Builds a `.prompt.md`: usage line per layer (`atom`, `molecule`, `organism`, `layout`; unknown falls back to `atom`), constraint, derived Props, examples |
| `derivePropsBlock(dts)` | `src/prompt.mjs` | Strips `import` lines and everything from the first `export declare` onward, leaving the interface/type block |
| `buildManifest({ dist, groupsOrder, namespace })` | `src/manifest.mjs` | Walks `dist` for `.html` files carrying a `@dsCard` marker, writes `_ds_manifest.json`, returns `{ count, groups }` |
| `checkLaws(options)` | `src/gates/check.mjs` | File-based law scan; returns `{ errors, warnings, filesChecked }` |
| `checkFrameworkFree({ dirs, frameworks })` | `src/gates/check.mjs` | Bans framework imports in the given directories; returns `{ errors }` |
| `typegate(root)` | `src/gates/check.mjs` | Runs `npx tsc --noEmit -p <root>`; returns `{ ok, output }` |
| `enforce({ laws, root, frameworkFree })` | `src/gates/check.mjs` | Runs all gates, prints warnings and violations, exits with code 1 on any error |
| `visual({ dist, dir, viewport, update })` | `src/gates/visual.mjs` | Visual regression gate (see [Visual gate](#visual-gate)) |
| `emitAsyncContracts({ outDir, systemNotes })` | `src/contracts.mjs` | Copies the canonical async contracts to `components/general/_contracts/` as `AsyncContracts.d.ts` plus a `.prompt.md`; `systemNotes` is appended to both |
| `extractContracts({ dtsPath, out, systemName, only })` | `src/extract.mjs` | Slices per-component `.d.ts` files out of a bundled declaration file using ts-morph; returns `{ components }` |
| `bundlePackage({ pkgDir, entry, globalName, out, meta })` | `src/bundle.mjs` | Builds `_vendor/react.js`, `_vendor/react-dom.js`, and an IIFE `_ds_bundle.js` whose React imports resolve to the `window` globals; returns `{ out }` |
| `verifyBundle({ out, stylesheet, globalName, component, childrenText })` | `src/bundle.mjs` | Mounts `window[globalName][component]` (default `Button`) in Chromium; exits with code 1 on a missing global, an empty render, or console errors |

`extractContracts` treats a name as a component when it starts with an uppercase letter and a matching `<Name>Props` declaration exists. Each emitted file contains the props, the component declaration, and the transitive closure of referenced local types, excluding other components.

## The laws

`checkLaws` scans files under `componentsDir` matching `extensions` (default `.jsx`, `.tsx`).

| Law | Severity | Behavior as implemented |
|-----|----------|-------------------------|
| Raw hex ban | error | Any `#` followed by 3 to 8 hex digits in a component file is rejected; use tokens |
| Import whitelist | error | Every `from '...'` specifier must be relative (`./`, `../`) or listed in `allowedImports` (default `['react', 'react-dom']`). An entry ending in `/` is a prefix (`'acme-forms/'` allows any subpath); any other entry must match exactly |
| Native element ban | error | For each `{ tag, exceptIn }` in `nativeElements`, a file containing `<tag` fails unless its file stem is in `exceptIn`. Empty by default |
| Numeric gap | warning | `gap: <number>` is reported as an advisory unless the file stem is in `numericSpacingExempt` |
| Framework-free | error | `checkFrameworkFree` reads files directly inside each of `dirs` (not recursive; missing directories are skipped) and rejects imports equal to or starting with an entry in `frameworks` (default `react`, `react-dom`, `@angular/`, `vue`, `svelte`) |
| Type gate | error | `enforce` runs `tsc --noEmit` when `root` is set and `<root>/node_modules` exists; without `node_modules` it emits a warning and skips |

Import detection matches single-quoted `from '...'` specifiers only.

## Async contracts

Pure types, no runtime, shared by every design system built on the canon:

```ts
import type { AsyncState, MutationState, ErrorScope } from 'romeo-ds-canon/contracts'

type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'revalidating'; data: T }
  | { status: 'error'; error: string; onRetry: () => void; data?: T }
  | { status: 'empty' }
  | { status: 'success'; data: T }

type MutationState<E = string> =
  | { status: 'idle' }
  | { status: 'optimistic' }
  | { status: 'error'; error: E }
  | { status: 'confirmed' }

type ErrorScope = 'component' | 'section' | 'page'
```

Laws attached to these contracts:

- Never model async state as sibling booleans.
- Destructive, irreversible, or payment mutations are never optimistic.
- No silent optimism: optimistic UI is signaled, never rendered as settled.
- The error state bundles `onRetry`, and the implementation emits `role="alert"`.

## Visual gate

Self-hosted and deterministic; no external service.

1. Starts a local HTTP server over `dist` on a random port.
2. Reads the card list from `dist/_ds_manifest.json`.
3. Launches headless Chromium (Playwright) at the configured viewport, aborts every request that is not `http://localhost`, and disables animations, transitions, and the caret.
4. Takes a full-page screenshot of each card into `<dir>/current/`.
5. If no baseline exists (or `update: true`), copies the screenshot to `<dir>/baseline/`. Otherwise compares with odiff (`threshold: 0.1`, `antialiasing: true`) and writes the diff image to `<dir>/diff/`.
6. Logs `ok / baselines / diffs` counts and exits with code 1 if any card differs.

Screenshot names are the card path with separators replaced by `__`. Because external requests are blocked, web fonts and remote assets do not load in the gate. If the `odiff-bin` postinstall did not run, the gate copies the platform binary into place itself.

## Project layout

```text
romeo-ds-canon/
  contracts/
    index.d.ts        canonical async contracts (types only)
  src/
    index.mjs         public exports + defineSystem
    emit.mjs          4-artifact emission, preview cards
    prompt.mjs        prompt derivation from .d.ts
    manifest.mjs      _ds_manifest.json builder
    contracts.mjs     emit async contracts into a dist
    extract.mjs       per-component contracts from a bundled .d.ts
    bundle.mjs        IIFE bundle + browser verification
    gates/
      check.mjs       law, framework-free, and type gates
      visual.mjs      visual regression gate
  package.json
```

There is no build step and no CLI; call the functions from your own build script.

## Versioning

- Semantic Versioning, released as git tags `vMAJOR.MINOR.PATCH`.
- Pre-1.0: minor versions may contain breaking changes.
- Releases are listed on the [GitHub Releases page](https://github.com/notrepeat/romeo-ds-canon/releases).
- Pin a version: `npm install github:notrepeat/romeo-ds-canon#v0.1.0`
- Local development alongside a consumer: `"romeo-ds-canon": "file:../romeo-ds-canon"`

## Status

Experimental. Known gaps:

- No automated tests yet.
- No license chosen yet.
- No CI yet.
- Not published to npm.
