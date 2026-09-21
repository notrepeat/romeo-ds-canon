// Anti-drift prompt derivation (canon §3.6.3): the Props block of every
// .prompt.md is EXTRACTED from the .d.ts string — single source, no hand-sync.

/** Strip the import lines and the `export declare` tail from a .d.ts string,
 *  leaving the interface/type block for the prompt's Props section. */
export function derivePropsBlock(dts) {
  return dts
    .split('\n')
    .filter((l) => !/^import /.test(l))
    .join('\n')
    .replace(/^export declare[\s\S]*$/m, '')
    .trim()
}

const LAYER_LINE = {
  atom: (sys, name) =>
    `Class-mapping wrapper over the ${sys} stylesheet — import from \`components/general/${name}/${name}.jsx\` or replicate its class mapping; the stylesheet must be loaded.`,
  molecule: (sys, name) =>
    `Molecule — composes atom contracts; import from \`components/general/${name}/${name}.jsx\`; the stylesheet must be loaded.`,
  organism: (sys, name) =>
    `Organism — composes atom/molecule contracts; import from \`components/general/${name}/${name}.jsx\`; the stylesheet must be loaded.`,
  layout: (sys, name) =>
    `Layout primitive — the structural layer; import from \`components/general/${name}/${name}.jsx\`.`,
}

/** Build a canonical .prompt.md: usage line + constraint callout + derived Props + stories. */
export function componentPrompt({ name, layer, systemName, constraint, dts, stories }) {
  const usage = (LAYER_LINE[layer] ?? LAYER_LINE.atom)(systemName, name)
  return `${name} from ${systemName}. ${usage}

${constraint}

## Props

\`\`\`ts
${derivePropsBlock(dts)}
\`\`\`

## Examples

${stories}
`
}
