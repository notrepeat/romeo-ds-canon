// romeo-ds-canon — the house design-system canon as an executable API.
// Verbs are pure functions; defineSystem binds them to one system's config.
export { previewCard, emitComponent } from './emit.mjs'
export { componentPrompt, derivePropsBlock } from './prompt.mjs'
export { buildManifest } from './manifest.mjs'
export { checkLaws, checkFrameworkFree, typegate, enforce } from './gates/check.mjs'
export { visual } from './gates/visual.mjs'
export { emitAsyncContracts } from './contracts.mjs'
export { extractContracts } from './extract.mjs'
export { bundlePackage, verifyBundle } from './bundle.mjs'

import { buildManifest } from './manifest.mjs'
import { enforce } from './gates/check.mjs'
import { visual } from './gates/visual.mjs'

/** Bind the canon verbs to one design system's config. */
export function defineSystem(config) {
  return {
    config,
    manifest: () =>
      buildManifest({ dist: config.out, groupsOrder: config.groupsOrder, namespace: config.namespace }),
    check: () =>
      enforce({
        laws: { componentsDir: config.componentsDir ?? `${config.out}/components`, ...config.laws },
        root: config.root,
        frameworkFree: config.frameworkFree,
      }),
    visual: (opts = {}) =>
      visual({ dist: config.out, dir: config.visualDir, viewport: config.viewport, ...opts }),
  }
}
