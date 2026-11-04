import { readdir, readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon, iconNames } from '../src/icon.js';

/** A 2 px stroke on screen: the width is 2 and no shape scales it with the 24-unit viewBox. */
function expectScreenStroke(html: string) {
  expect(html).toContain('stroke-width="2"');
  const shapes = html.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*>/g) ?? [];
  expect(shapes.length).toBeGreaterThan(0);
  for (const shape of shapes) expect(shape).toContain('vector-effect="non-scaling-stroke"');
}

describe('Icon', () => {
  it.each(iconNames)('%s is hidden from assistive technology by default', (name) => {
    const html = renderToStaticMarkup(<Icon name={name} />);
    expect(html).toMatch(/^<svg /);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role=');
    expect(html).toContain('stroke="currentColor"');
    expectScreenStroke(html);
  });

  it('is announced as an image when it carries a label', () => {
    const label = 'Atenção';
    const html = renderToStaticMarkup(<Icon name="alert" label={label} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Atenção"');
    expect(html).not.toContain('aria-hidden="true"');
  });

  it('stays hidden when the label is empty, rather than announcing a nameless image', () => {
    const html = renderToStaticMarkup(<Icon name="alert" label="" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role=');
  });

  it('keeps a 2 px stroke at any size', () => {
    const html = renderToStaticMarkup(<Icon name="home" size={32} />);
    expect(html).toContain('width="32"');
    expectScreenStroke(html);
  });

  it('is the only module in the package that imports lucide-react', async () => {
    const sources = await readdir(new URL('../src/', import.meta.url), { recursive: true });
    const importers: string[] = [];
    for (const file of sources.filter((name) => /\.tsx?$/.test(name))) {
      const text = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
      if (/from ['"]lucide-react/.test(text)) importers.push(file);
    }
    expect(importers).toEqual(['icon.tsx']);
  });
});
