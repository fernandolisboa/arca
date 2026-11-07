import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { CoachMark } from '../src/patterns/coach-mark.js';
import { NextActionCard } from '../src/patterns/next-action-card.js';
import { ProgressBar } from '../src/patterns/progress-bar.js';
import { RankingRow } from '../src/patterns/ranking-row.js';
import { ScaleChoice } from '../src/patterns/scale-choice.js';
import { formatCalendarDate, SourceLine } from '../src/patterns/source-line.js';
import { StarRating } from '../src/patterns/star-rating.js';
import { StatusChip } from '../src/patterns/status-chip.js';
import type { ShellLinkProps } from '../src/shell/nav.js';

const noop = () => undefined;

/** The elements a keyboard reaches, in order: links, buttons and anything with a tab stop. */
function tabStops(html: string): string[] {
  return [...html.matchAll(/<(a|button)\b[^>]*>|<[a-z]+\b[^>]*tabindex="0"[^>]*>/g)].map(
    (match) => match[1] ?? 'tabindex',
  );
}

function Anchor({ href, className, children }: ShellLinkProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

const nextAction = {
  from: 'Curitiba',
  to: 'Lisboa',
  routeLabel: 'De Curitiba para Lisboa',
  title: 'Pedir a certidão de nascimento',
  details: 'No cartório, em até 5 dias úteis, com RG e CPF',
  actionLabel: 'Ver como pedir',
};
const portugal = {
  position: 1,
  name: 'Portugal',
  code: 'PT',
  score: 87.5,
  maxScore: 100,
  locale: 'pt-BR',
};
const portugalInWords = { ...portugal, scoreLabel: '87,5 de 100' };
const ninth = { ...portugal, position: 9 };
const unitedStates = {
  position: 2,
  name: 'Estados Unidos',
  code: 'US',
  score: 1234,
  maxScore: 2000,
  locale: 'pt-BR',
  href: '/paises/us',
};
const progress = (label: string, value: number, max: number) => ({
  label,
  value,
  max,
  valueText: `${String(value)} de ${String(max)}`,
});
const familyDocuments = progress('Documentos da família', 3, 12);
const overflowing = progress('Passos', 5, 4);
const empty = progress('Passos', 0, 0);
const source = {
  href: 'https://travel.state.gov/content/travel/en/us-visas.html',
  verifiedOn: '2026-01-01',
  locale: 'pt-BR',
  message: 'Fonte: {host} · verificado em {date}',
};
const insecureSource = { ...source, href: 'http://travel.state.gov/' };
const scriptSource = { ...source, href: 'javascript:alert(1)' };
const tourStep = {
  targetIds: ['nav-plan-wide', 'nav-plan'],
  title: 'Seu plano',
  body: 'Aqui ficam os passos, na ordem.',
  stepLabel: '2 de 4',
};

describe('NextActionCard', () => {
  const html = renderToStaticMarkup(<NextActionCard {...nextAction} onAction={noop} />);

  it('shows the route, the step and one button, labelled by its title', () => {
    expect(html).toContain('Pedir a certidão de nascimento');
    expect(html).toContain('No cartório, em até 5 dias úteis, com RG e CPF');
    expect(html).toMatch(/<section aria-labelledby="([^"]+)"[^>]*>.*<h2 id="\1"/);
    expect(tabStops(html)).toEqual(['button']);
    expect(html).toMatch(/<button type="button"[^>]*>Ver como pedir<\/button>/);
  });

  it('reads the route as a sentence and hides the drawing', () => {
    expect(html).toContain('<p class="sr-only">De Curitiba para Lisboa</p>');
    expect(html).toMatch(/<div aria-hidden="true"[^>]*><span>Curitiba<\/span>/);
    expect(html).toContain('animate-route-dot');
  });
});

describe('RankingRow', () => {
  it('shows position, code, name and the score for the locale, with the bar hidden', () => {
    const html = renderToStaticMarkup(<RankingRow {...portugal} />);
    expect(html).toContain('>1</span>');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>PT<\/span>/);
    expect(html).toContain('>Portugal</span>');
    expect(html).toContain('>87,5</span>');
    expect(html).toContain('text-primary');
    expect(html).toMatch(/<svg aria-hidden="true" focusable="false"/);
    expect(html).toMatch(
      /width="87.5%" height="100%" class="[^"]*animate-bar-grow[^"]*fill-primary"/,
    );
    expect(html).toContain('[animation-delay:0ms]');
    expect(tabStops(html)).toEqual([]);
  });

  it('reads the score in words when given them, and staggers only the first six rows', () => {
    const html = renderToStaticMarkup(<RankingRow {...portugalInWords} />);
    expect(html).toContain(
      '<span aria-hidden="true">87,5</span><span class="sr-only">87,5 de 100</span>',
    );
    const late = renderToStaticMarkup(<RankingRow {...ninth} />);
    expect(late).toContain('[animation-delay:calc(var(--arca-stagger-step)*5)]');
  });

  it('uses `second` after the first place and links the name when given a route', () => {
    const html = renderToStaticMarkup(<RankingRow {...unitedStates} link={Anchor} />);
    expect(html).toContain('fill-second');
    expect(html).toContain('>1.234</span>');
    expect(tabStops(html)).toEqual(['a']);
    expect(html).toMatch(/<a href="\/paises\/us"[^>]*>Estados Unidos<\/a>/);
  });
});

describe('ScaleChoice', () => {
  const legend = 'Segurança';
  const render = (description?: string) =>
    renderToStaticMarkup(
      <ScaleChoice
        legend={legend}
        {...(description === undefined ? {} : { description })}
        min={0}
        max={5}
        value={4}
        onChange={noop}
      />,
    );

  it('is a fieldset with one native radio per step, the chosen one checked', () => {
    const html = render();
    expect(html).toMatch(/^<fieldset/);
    expect(html).toContain('>Segurança</legend>');
    expect(html.match(/type="radio"/g)).toHaveLength(6);
    expect(new Set([...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1])).size).toBe(1);
    expect(html).toMatch(/checked="" value="4"/);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).not.toContain('aria-describedby');
  });

  it('ties the description to the group', () => {
    const html = render('0 deixa de fora');
    expect(html).toMatch(/aria-describedby="([^"]+)".*<p id="\1"[^>]*>0 deixa de fora<\/p>/);
  });
});

describe('StarRating', () => {
  const props = {
    legend: 'Clima em Portugal',
    onChange: noop,
    onClear: noop,
    starLabel: (stars: number) => `${String(stars)} de 5 estrelas`,
    clearLabel: 'Tirar a nota',
  };

  it('names each star in words and fills the chosen one and those before it', () => {
    const html = renderToStaticMarkup(<StarRating {...props} value={3} />);
    expect(html).toContain('<legend class="sr-only">Clima em Portugal</legend>');
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toContain('<span class="sr-only">3 de 5 estrelas</span>');
    expect(html).toMatch(/checked="" value="3"/);
    expect(html.match(/fill-current/g)).toHaveLength(3);
    expect(tabStops(html)).toEqual(['button']);
    expect(html).toContain('>Tirar a nota</button>');
  });

  it('has no star filled and nothing to clear before a rating', () => {
    const html = renderToStaticMarkup(<StarRating {...props} value={undefined} />);
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('fill-current');
    expect(tabStops(html)).toEqual([]);
  });
});

describe('ProgressBar', () => {
  it('carries the value in text, for sight and for screen readers', () => {
    const html = renderToStaticMarkup(<ProgressBar {...familyDocuments} />);
    expect(html).toMatch(/<span id="([^"]+)">Documentos da família<\/span>.*aria-labelledby="\1"/);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>3 de 12<\/span>/);
    expect(html).toContain('role="progressbar" aria-labelledby');
    expect(html).toContain(
      'aria-valuemin="0" aria-valuemax="12" aria-valuenow="3" aria-valuetext="3 de 12"',
    );
    expect(html).toContain('width="25%"');
    expect(tabStops(html)).toEqual([]);
  });

  it('keeps the fill inside the track', () => {
    const full = renderToStaticMarkup(<ProgressBar {...overflowing} />);
    expect(full).toMatch(/width="100%" height="100%" class="[^"]*fill-primary"/);
    expect(full).toContain('aria-valuemax="4" aria-valuenow="4"');
    const none = renderToStaticMarkup(<ProgressBar {...empty} />);
    expect(none).toMatch(/width="0%" height="100%" class="[^"]*fill-primary"/);
  });
});

describe('SourceLine', () => {
  const html = renderToStaticMarkup(<SourceLine {...source} />);

  it('names the source as a link and the verification date as a calendar date', () => {
    expect(html).toContain(
      'Fonte: <a href="https://travel.state.gov/content/travel/en/us-visas.html" rel="noopener noreferrer"',
    );
    expect(html).toContain(
      '>travel.state.gov</a> · verificado em <time dateTime="2026-01-01">01/01/2026</time>',
    );
    expect(html).toContain('text-caption');
    expect(tabStops(html)).toEqual(['a']);
  });

  it('shows nothing for a source that is not https', () => {
    expect(renderToStaticMarkup(<SourceLine {...insecureSource} />)).toBe('');
    expect(renderToStaticMarkup(<SourceLine {...scriptSource} />)).toBe('');
  });

  const zone = process.env['TZ'];
  afterEach(() => {
    if (zone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = zone;
  });

  it.each(['UTC', 'America/Sao_Paulo', 'Pacific/Pago_Pago', 'Pacific/Kiritimati', 'Asia/Tokyo'])(
    'reads 2026-01-01 as that day in %s',
    (timeZone) => {
      process.env['TZ'] = timeZone;
      // Proves the zone took effect, so the test cannot pass without testing anything.
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timeZone);
      expect(formatCalendarDate('2026-01-01', 'pt-BR')).toBe('01/01/2026');
      expect(formatCalendarDate('2026-12-31', 'en-US')).toBe('12/31/26');
    },
  );

  it('keeps a year before 100 (not 1942) and leaves a malformed date as it is', () => {
    expect(formatCalendarDate('0042-03-04', 'pt-BR')).toBe('04/03/42');
    expect(formatCalendarDate('2026-1-1', 'pt-BR')).toBe('2026-1-1');
    expect(formatCalendarDate('2026-02-30', 'pt-BR')).toBe('2026-02-30');
    expect(formatCalendarDate('2024-02-29', 'pt-BR')).toBe('29/02/2024');
  });
});

describe('StatusChip', () => {
  it.each([
    ['ok', 'Versão ativa', 'bg-ok-bg text-ok-ink'],
    ['warn', 'Versão aguardando ativação', 'bg-warn-bg text-warn-ink'],
    ['unknown', 'Pesquisa pendente', 'bg-soft text-muted'],
  ] as const)('shows %s as text with its tone', (tone, label, classes) => {
    const html = renderToStaticMarkup(<StatusChip tone={tone} label={label} />);
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain(classes);
    expect(html).toContain(`>${label}</span>`);
    expect(tabStops(html)).toEqual([]);
  });
});

describe('CoachMark', () => {
  const labels = { skip: 'Pular', back: 'Voltar', next: 'Próximo', done: 'Concluir' };
  const step = (first: boolean, last: boolean) =>
    renderToStaticMarkup(
      <CoachMark
        {...tourStep}
        first={first}
        last={last}
        labels={labels}
        onSkip={noop}
        onBack={noop}
        onNext={noop}
      />,
    );

  it('is a dialog named by its title and described by its text', () => {
    const html = step(false, false);
    expect(html).toMatch(/role="dialog" aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/);
    const [, titleId, bodyId] =
      /aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/.exec(html) ?? [];
    expect(html).toContain(`<h2 id="${String(titleId)}"`);
    expect(html).toContain(`<p id="${String(bodyId)}">Aqui ficam os passos, na ordem.</p>`);
    expect(html).toContain('>2 de 4</p>');
    expect(html).toContain('tabindex="-1"');
  });

  it('offers Skip, Back and Next in the middle, no Back on the first step, and Done on the last', () => {
    const buttons = (html: string) =>
      [...html.matchAll(/<button type="button"[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]);
    expect(buttons(step(false, false))).toEqual(['Pular', 'Voltar', 'Próximo']);
    expect(buttons(step(true, false))).toEqual(['Pular', 'Próximo']);
    expect(buttons(step(false, true))).toEqual(['Pular', 'Voltar', 'Concluir']);
  });

  it('dims the page with `bg` at 70% before the target is measured', () => {
    expect(step(true, false)).toContain('bg-bg/70');
  });
});
