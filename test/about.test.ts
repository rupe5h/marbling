import { describe, expect, it } from 'vitest';
import { deformTools } from '../src/tools/deform';
import { paintTools } from '../src/tools/paint';
import html from '../src/ui/about.html?raw';
import { EXAMPLES } from '../src/ui/examples';

describe('docs', () => {
  const ids = [...paintTools(), ...deformTools()].map((t) => t.id);

  it('has a section and an example figure for every tool', () => {
    for (const id of ids) {
      expect(html, id).toContain(`data-tool="${id}"`);
      expect(html, id).toContain(`data-example="${id}"`);
      expect(EXAMPLES[id]?.actions.length, id).toBeGreaterThan(0);
    }
  });

  it('documents no tool that does not exist', () => {
    const documented = [...html.matchAll(/data-tool="([^"]+)"/g)].map((m) => m[1]);
    expect(documented.sort()).toEqual([...ids].sort());
    expect(Object.keys(EXAMPLES).sort()).toEqual([...ids].sort());
  });

  it('links every reference it cites', () => {
    for (const [, ref] of html.matchAll(/href="#(ref-[^"]+)"/g)) expect(html).toContain(`id="${ref}"`);
  });
});
