import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Disclosure } from '../src/patterns/disclosure.js';

const words = {
  title: 'Resumo feito pela IA',
  aside: 'Conferida',
  body: 'O corpo.',
  footer: 'A IA pode errar.',
};

const render = (defaultOpen: boolean) =>
  renderToStaticMarkup(
    <Disclosure
      title={words.title}
      level={4}
      icon="ai"
      aside={<span>{words.aside}</span>}
      defaultOpen={defaultOpen}
      footer={<p>{words.footer}</p>}
      className="surface"
    >
      <p>{words.body}</p>
    </Disclosure>,
  );

describe('Disclosure', () => {
  it('names the region after the title alone, not the aside', () => {
    const html = render(true);
    const [, titleId] = /<section aria-labelledby="([^"]+)" class="surface">/.exec(html) ?? [];
    expect(html).toContain(
      `<span id="${String(titleId)}" class="min-w-0 flex-1">Resumo feito pela IA</span>`,
    );
    expect(html).toMatch(/<\/h4><span>Conferida<\/span>/);
  });

  it('puts the toggle inside the heading, controlling the body', () => {
    const html = render(true);
    const [, bodyId] =
      /<h4[^>]*><button type="button" aria-expanded="true" aria-controls="([^"]+)"/.exec(html) ??
      [];
    expect(bodyId).toBeDefined();
    expect(html).toContain(
      `<div id="${String(bodyId)}" class="flex flex-col gap-2"><p>O corpo.</p></div>`,
    );
  });

  it('starts closed when asked, with the body hidden but still in the page', () => {
    const html = render(false);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(
      /<div id="[^"]+" hidden="" class="flex flex-col gap-2"><p>O corpo.<\/p><\/div>/,
    );
  });

  it('turns the chevron down while open, with the base duration token that motion off zeroes', () => {
    expect(render(true)).toMatch(
      /data-open="true" class="[^"]*duration-\(--arca-duration-base\)[^"]*data-open:rotate-90/,
    );
    expect(render(false)).not.toContain('data-open=');
  });

  it('keeps the toggle at the touch height', () => {
    expect(render(true)).toMatch(/aria-controls="[^"]+" class="[^"]*\bmin-h-touch\b/);
  });

  it('follows the parent when it keeps the state', () => {
    const html = renderToStaticMarkup(
      <Disclosure
        title={words.title}
        level={4}
        defaultOpen={false}
        open
        onOpenChange={() => undefined}
        className="surface"
      >
        <p>{words.body}</p>
      </Disclosure>,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('hidden=""');
  });

  it('keeps the footer outside the body, so it shows while folded', () => {
    expect(render(false)).toMatch(/<\/p><\/div><p>A IA pode errar.<\/p><\/section>$/);
  });
});
