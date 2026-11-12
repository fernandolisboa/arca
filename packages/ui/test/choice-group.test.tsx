import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChoiceGroup } from '../src/choice-group.js';

const text = { legend: 'Cantos', description: 'Vale para cartões e botões.' };
const choices = [
  { value: 'square', label: 'Retos' },
  { value: 'round', label: 'Arredondados' },
] as const;

const detailed = [
  { value: 'yes', label: 'Sim', detail: 'Entra nas rotas.' },
  { value: 'no', label: 'Não', detail: 'Fica só como parente.' },
] as const;

const render = (description?: string) =>
  renderToStaticMarkup(
    <ChoiceGroup
      legend={text.legend}
      {...(description === undefined ? {} : { description })}
      choices={choices}
      value="round"
      onChange={() => undefined}
    />,
  );

describe('ChoiceGroup', () => {
  it('is a fieldset of native radios named by their labels', () => {
    const html = render();
    expect(html).toMatch(/^<fieldset/);
    expect(html).toContain(`<legend class="mb-2 font-medium">${text.legend}</legend>`);
    expect(html.match(/<label/g)).toHaveLength(2);
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    const names = [...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names).size).toBe(1);
  });

  it('checks only the current value', () => {
    const html = render();
    expect(html).toMatch(/checked="" value="round"/);
    expect(html).not.toMatch(/checked="" value="square"/);
  });

  it('ties the description to the group', () => {
    const html = render(text.description);
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${String(id)}"`);
  });

  it('stacks answers with a detail line under each label', () => {
    const html = renderToStaticMarkup(
      <ChoiceGroup
        legend={text.legend}
        choices={detailed}
        value="yes"
        onChange={() => undefined}
        stacked
      />,
    );
    expect(html).not.toContain('sm:grid-cols-2');
    expect(html).toContain('<span class="font-medium">Sim</span>');
    expect(html).toContain('<span class="text-small text-muted">Fica só como parente.</span>');
  });
});
