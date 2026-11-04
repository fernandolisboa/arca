import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Mark, markViewBox } from '../src/mark.js';

const paths = (svg: string) =>
  [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);

describe('Mark', () => {
  it('draws the same shapes as the brand SVG', async () => {
    const brand = await readFile(
      new URL('../../../docs/brand/arca-mark.svg', import.meta.url),
      'utf8',
    );
    const html = renderToStaticMarkup(<Mark size={48} />);
    expect(paths(html)).toEqual(paths(brand));
    expect(brand).toContain(`viewBox="${markViewBox}"`);
    expect(html).toContain(`viewBox="${markViewBox}"`);
    expect(brand).toMatch(/fill-rule="evenodd"[^>]*d="M17 36/);
    expect(html).toMatch(/fill-rule="evenodd"[^>]*d="M17 36/);
  });

  it('drops the windows at 32 px and below', () => {
    expect(paths(renderToStaticMarkup(<Mark size={32} />))).toHaveLength(4);
    expect(paths(renderToStaticMarkup(<Mark size={33} />))).toHaveLength(5);
  });

  it('is decorative and colored by the mark tokens', () => {
    const html = renderToStaticMarkup(<Mark />);
    expect(html).toContain('aria-hidden="true"');
    for (const part of ['hull', 'house', 'roof', 'ramp']) {
      expect(html).toContain(`fill-(--arca-mark-${part})`);
    }
  });
});
