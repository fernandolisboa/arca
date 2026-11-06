import { describe, expect, it } from 'vitest';
import { menuItemClass } from '../src/patterns/menu-item.js';

describe('menuItemClass', () => {
  it('keeps the touch target and a visible keyboard focus', () => {
    expect(menuItemClass).toContain('min-h-touch');
    expect(menuItemClass).toContain('focus-visible:outline-2');
  });

  it('marks the current item from data-current, on both widths', () => {
    expect(menuItemClass).toContain('data-current:bg-soft');
    expect(menuItemClass).toContain('lg:data-current:shadow-');
  });
});
