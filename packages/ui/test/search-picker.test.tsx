import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { matchesSearch } from '../src/patterns/field.js';
import { SearchPicker, foundGroups } from '../src/patterns/search-picker.js';

const groups = [
  {
    title: 'Profissionais das ciências e intelectuais',
    options: [
      { value: '2211', label: 'Médicos clínicos gerais' },
      { value: '2512', label: 'Desenvolvedores de software' },
    ],
  },
  {
    title: 'Técnicos e profissionais de nível médio',
    options: [{ value: '3221', label: 'Técnicos de enfermagem' }],
  },
];

const words = { label: 'Ocupação', placeholder: 'Escolha' };
const labels = { search: 'Buscar', none: 'Nada encontrado.', clear: 'Limpar', close: 'Fechar' };

describe('matchesSearch', () => {
  it.each([
    ['Letônia', 'leto'],
    ['Letônia', 'LETÔ'],
    ['Médicos clínicos gerais', 'medico'],
    ['Japão', '  japao '],
    ['Portugal', ''],
  ])('finds %s for %j', (name, search) => {
    expect(matchesSearch(name, search)).toBe(true);
  });

  it.each([
    ['Portugal', 'porto'],
    ['Chile', 'china'],
  ])('leaves %s out for %j', (name, search) => {
    expect(matchesSearch(name, search)).toBe(false);
  });
});

describe('foundGroups', () => {
  it('keeps the options whose label answers the search, ignoring accents and case', () => {
    expect(foundGroups(groups, 'MEDICO')).toEqual([
      { ...groups[0], id: '0', options: [{ value: '2211', label: 'Médicos clínicos gerais' }] },
    ]);
  });

  it('keys each group by its place among the groups given, whatever the search drops', () => {
    expect(foundGroups(groups, 'enfermagem').map(({ id }) => id)).toEqual(['1']);
  });

  it('keeps every option for an empty search, and none for one nothing answers', () => {
    expect(foundGroups(groups, '').flatMap(({ options }) => options)).toHaveLength(3);
    expect(foundGroups(groups, 'astronauta')).toEqual([]);
  });
});

describe('SearchPicker', () => {
  const render = (value: string, layout?: 'grid' | 'list') =>
    renderToStaticMarkup(
      <SearchPicker
        label={words.label}
        value={value}
        onChange={() => undefined}
        placeholder={words.placeholder}
        groups={groups}
        labels={labels}
        lead={(code) => <i data-code={code} />}
        {...(layout === undefined ? {} : { layout })}
      />,
    );

  it('shows the chosen option in the field with its lead, named by the label and the choice', () => {
    const html = render('2512');
    const [, labelId, valueId] =
      /<button[^>]*aria-labelledby="([^" ]+) ([^"]+)"[^>]*><i data-code="2512"><\/i><span id="[^"]+"/.exec(
        html,
      ) ?? [];
    expect(html).toContain(`<label id="${String(labelId)}"`);
    expect(html).toContain(
      `<span id="${String(valueId)}" class="min-w-0 flex-1 truncate">Desenvolvedores de software</span>`,
    );
  });

  it('shows the placeholder while nothing is chosen, and no clear option', () => {
    const html = render('');
    expect(html).toContain('>Escolha</span>');
    expect(html).not.toContain('>Limpar</button>');
  });

  it('marks the chosen option pressed and lists long labels in one column, two from medium screens', () => {
    const html = render('2211', 'list');
    expect(html).toContain('<ul class="grid grid-cols-1 gap-2 md:grid-cols-2">');
    expect(html).toMatch(/aria-pressed="true"[^>]*><i data-code="2211"><\/i>/);
    expect(html).toContain('>Limpar</button>');
  });

  it('lays short labels out as a grid of tiles by default', () => {
    expect(render('')).toContain(
      '<ul class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">',
    );
  });
});
