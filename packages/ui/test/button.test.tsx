import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '../src/button.js';

const label = 'Avançar';

describe('Button', () => {
  it('is a primary, non-submitting button by default', () => {
    const html = renderToStaticMarkup(<Button>{label}</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain('bg-primary');
    expect(html).toContain('min-h-touch');
  });

  it('has a quieter outlined secondary variant with the same touch target', () => {
    const html = renderToStaticMarkup(<Button variant="secondary">{label}</Button>);
    expect(html).not.toContain('bg-primary');
    expect(html).toContain('border-line');
    expect(html).toContain('min-h-touch');
    expect(html).not.toContain('variant=');
  });
});
