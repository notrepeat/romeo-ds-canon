// Law gate tests — real exported functions against real temp directories, no mocks.
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkLaws, checkFrameworkFree } from '../../src/gates/check.mjs'

const dirs = []

/** Create a temp dir holding the given {filename: source} fixtures. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-canon-check-'))
  dirs.push(dir)
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src)
  return dir
}

/** Law errors for a single component source. */
function lawErrors(src, opts = {}, file = 'Card.jsx') {
  return checkLaws({ componentsDir: fixture({ [file]: src }), ...opts }).errors
}

/** Framework-free errors for a single core source. */
function frameworkErrors(src, opts = {}) {
  return checkFrameworkFree({ dirs: [fixture({ 'core.mjs': src })], ...opts }).errors
}

afterEach(() => {
  // Retries absorb transient EBUSY/EPERM file locks on Windows.
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

describe('existing behavior', () => {
  it('flags single-quoted external imports', () => {
    const errors = lawErrors(`import x from 'lodash'\n`)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /Card\.jsx: external runtime import 'lodash' banned/)
  })

  it('allows relative imports', () => {
    assert.deepEqual(lawErrors(`import a from './a'\nimport b from '../b'\n`), [])
  })

  it('allows whitelisted imports', () => {
    assert.deepEqual(lawErrors(`import React from 'react'\n`), [])
  })

  it('allows subpaths of a trailing-slash allowedImports entry', () => {
    const errors = lawErrors(`import f from 'romeo-forms/field'\n`, { allowedImports: ['romeo-forms/'] })
    assert.deepEqual(errors, [])
  })

  it('does not allow subpaths of an exact allowedImports entry', () => {
    const errors = lawErrors(`import f from 'romeo-forms/field'\n`, { allowedImports: ['romeo-forms'] })
    assert.equal(errors.length, 1)
  })

  it('flags 3-digit hex colors', () => {
    const errors = lawErrors(`const s = { color: '#fff' }\n`)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /raw hex banned.*#fff/)
  })

  it('flags 6-digit hex colors', () => {
    assert.match(lawErrors(`const s = { color: '#1a2b3c' }\n`)[0], /#1a2b3c/)
  })

  it('flags 8-digit hex colors', () => {
    assert.match(lawErrors(`const s = { color: '#1a2b3c80' }\n`)[0], /#1a2b3c80/)
  })

  it('flags a banned native element', () => {
    const errors = lawErrors(`export const C = () => <button>ok</button>\n`, { nativeElements: [{ tag: 'button' }] })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /native <button> banned/)
  })

  it('exempts the file stem listed in exceptIn', () => {
    const errors = lawErrors(
      `export const Button = () => <button>ok</button>\n`,
      { nativeElements: [{ tag: 'button', exceptIn: ['Button'] }] },
      'Button.jsx',
    )
    assert.deepEqual(errors, [])
  })

  it('flags react in a framework-free dir', () => {
    const errors = frameworkErrors(`import React from 'react'\n`)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /core\.mjs: framework import 'react' banned/)
  })

  it('flags @angular/core in a framework-free dir', () => {
    assert.match(frameworkErrors(`import { Component } from '@angular/core'\n`)[0], /'@angular\/core'/)
  })
})

describe('import detection', () => {
  it('flags double-quoted external imports', () => {
    assert.match(lawErrors(`import x from "lodash"\n`)[0] ?? '', /'lodash' banned/)
  })

  it('flags side-effect imports', () => {
    assert.match(lawErrors(`import 'lodash'\n`)[0] ?? '', /'lodash' banned/)
  })

  it('flags double-quoted side-effect imports', () => {
    assert.match(lawErrors(`import "lodash"\n`)[0] ?? '', /'lodash' banned/)
  })

  it('flags dynamic imports', () => {
    assert.match(lawErrors(`const m = await import('lodash')\n`)[0] ?? '', /'lodash' banned/)
  })

  it('flags require calls', () => {
    assert.match(lawErrors(`const m = require('lodash')\n`)[0] ?? '', /'lodash' banned/)
  })

  it('flags double-quoted require calls', () => {
    assert.match(lawErrors(`const m = require("lodash")\n`)[0] ?? '', /'lodash' banned/)
  })

  it('flags re-exports from external packages', () => {
    assert.match(lawErrors(`export { a } from "lodash"\n`)[0] ?? '', /'lodash' banned/)
  })

  it('reports each import statement once', () => {
    assert.equal(lawErrors(`import x from 'lodash'\n`).length, 1)
  })

  it('flags double-quoted framework imports in a framework-free dir', () => {
    assert.match(frameworkErrors(`import React from "react"\n`)[0] ?? '', /'react' banned/)
  })

  it('flags side-effect framework imports in a framework-free dir', () => {
    assert.match(frameworkErrors(`import 'react'\n`)[0] ?? '', /'react' banned/)
  })

  it('flags dynamic framework imports in a framework-free dir', () => {
    assert.match(frameworkErrors(`const r = await import('react')\n`)[0] ?? '', /'react' banned/)
  })

  it('flags required frameworks in a framework-free dir', () => {
    assert.match(frameworkErrors(`const r = require("react")\n`)[0] ?? '', /'react' banned/)
  })

  it('flags framework re-exports in a framework-free dir', () => {
    assert.match(frameworkErrors(`export * from 'react'\n`)[0] ?? '', /'react' banned/)
  })
})

describe('framework matching', () => {
  it('does not flag react-aria as react', () => {
    assert.deepEqual(frameworkErrors(`import { useButton } from 'react-aria'\n`), [])
  })

  it('does not flag vuex as vue', () => {
    assert.deepEqual(frameworkErrors(`import { createStore } from 'vuex'\n`), [])
  })

  it('does not flag svelte-check as svelte', () => {
    assert.deepEqual(frameworkErrors(`import check from 'svelte-check'\n`), [])
  })

  it('flags subpaths of an exact framework entry', () => {
    assert.match(frameworkErrors(`import { jsx } from 'react/jsx-runtime'\n`)[0] ?? '', /'react\/jsx-runtime' banned/)
  })

  it('flags react-dom subpaths', () => {
    assert.match(frameworkErrors(`import { createRoot } from 'react-dom/client'\n`)[0] ?? '', /'react-dom\/client' banned/)
  })
})

describe('raw hex ban', () => {
  it('does not flag double-quoted href anchors', () => {
    assert.deepEqual(lawErrors(`export const C = () => <a href="#faded">x</a>\n`), [])
  })

  it('does not flag single-quoted href anchors', () => {
    assert.deepEqual(lawErrors(`export const C = () => <a href='#abc'>x</a>\n`), [])
  })

  it('does not flag url(#id) SVG references', () => {
    assert.deepEqual(lawErrors(`export const C = () => <rect fill="url(#abc)" />\n`), [])
  })

  it('does not flag xlink:href fragments', () => {
    assert.deepEqual(lawErrors(`export const C = () => <use xlink:href="#def" />\n`), [])
  })

  it('does not flag 5-digit hex runs', () => {
    assert.deepEqual(lawErrors(`const s = '#abcde'\n`), [])
  })

  it('does not flag 7-digit hex runs', () => {
    assert.deepEqual(lawErrors(`const s = '#abcdef0'\n`), [])
  })

  it('flags 4-digit hex colors', () => {
    assert.match(lawErrors(`const s = { color: '#fff8' }\n`)[0] ?? '', /#fff8/)
  })

  it('still flags a real color next to an anchor', () => {
    const errors = lawErrors(`export const C = () => <a href="#faded" style={{ color: '#fff' }}>x</a>\n`)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /\(#fff\)/)
  })
})

describe('native element ban', () => {
  const ban = { nativeElements: [{ tag: 'button' }] }

  it('does not flag a longer tag sharing the prefix', () => {
    assert.deepEqual(lawErrors(`export const C = () => <buttonGroup>x</buttonGroup>\n`, ban), [])
  })

  it('flags a tag followed by a space', () => {
    assert.equal(lawErrors(`export const C = () => <button type="button">x</button>\n`, ban).length, 1)
  })

  it('flags a self-closing tag', () => {
    assert.equal(lawErrors(`export const C = () => <button/>\n`, ban).length, 1)
  })

  it('flags a tag followed by a newline', () => {
    assert.equal(lawErrors(`export const C = () => <button\n  type="button" />\n`, ban).length, 1)
  })
})
