import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MenuToggle } from '../src/menu-toggle.js';

const props = { controls: 'menu-panel', openLabel: 'Abrir menu', closeLabel: 'Fechar menu' };

const render = (open: boolean) =>
  renderToStaticMarkup(<MenuToggle open={open} onToggle={() => undefined} {...props} />);

describe('MenuToggle', () => {
  it('offers to open the menu while closed', () => {
    const html = render(false);
    expect(html).toContain('aria-label="Abrir menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="menu-panel"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('rotate-45');
  });

  it('becomes the close control while open, with the lines crossed into an X', () => {
    const html = render(true);
    expect(html).toContain('aria-label="Fechar menu"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/data-line="top" class="[^"]*\brotate-45\b/);
    expect(html).toMatch(/data-line="middle" class="[^"]*\bopacity-0\b/);
    expect(html).toMatch(/data-line="bottom" class="[^"]*-rotate-45\b/);
  });

  it('animates with the base duration token, which motion off zeroes', () => {
    expect(render(false)).toContain('duration-(--arca-duration-base)');
  });
});
