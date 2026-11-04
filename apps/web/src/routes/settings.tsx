import { Button, ChoiceGroup, type Choice } from '@arca/ui';
import { axes, type AxisName, type AxisValue } from '@arca/ui/theme/ids';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { appearance, useAppearance } from '../appearance/store.js';
import { AccountDeletionSection } from '../account-deletion.js';
import { DataExportSection } from '../data-export.js';

export const Route = createFileRoute('/settings')({ component: Settings });

const groups = [
  'theme',
  'mode',
  'font',
  'corners',
  'navNarrow',
  'navWide',
  'dockEdge',
  'textSize',
  'contrast',
  'motion',
] as const satisfies readonly AxisName[];

/** Stands for "no choice": clears the axis, so it follows the default. */
const noChoice = 'default';
type Answer<A extends AxisName> = AxisValue<A> | typeof noChoice;

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = matchMedia(query);
      media.addEventListener('change', onChange);
      return () => {
        media.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

const swatchColors = ['bg-bg', 'bg-primary', 'bg-second'] as const;

/** The palette's own tokens, scoped to this element, so the preview follows mode and contrast. */
function Swatches({ theme }: { readonly theme: string }) {
  const { resolved } = useAppearance();
  return (
    <span
      aria-hidden="true"
      data-theme={theme}
      data-mode={resolved.mode}
      data-contrast={resolved.contrast}
      className="flex shrink-0 gap-1"
    >
      {swatchColors.map((color) => (
        <span key={color} className={`size-4 rounded-full ring-1 ring-line ${color}`} />
      ))}
    </span>
  );
}

function Settings() {
  const { t } = useTranslation();
  const { preferences, resolved } = useAppearance();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [cleared, setCleared] = useState(false);

  const label = (axis: AxisName, value: string) =>
    t(`settings.appearance.${axis}.${value}` as never);

  const previews: Partial<Record<AxisName, (value: string) => ReactNode>> = {
    theme: (value) => <Swatches theme={value} />,
    font: (value) => (
      <span aria-hidden="true" data-font={value} className="shrink-0 font-display text-lead">
        {t('settings.appearance.font.sample')}
      </span>
    ),
  };

  function group<A extends AxisName>(axis: A, values: readonly AxisValue<A>[]) {
    const fallback = axes[axis].default;
    const preview = previews[axis];
    const choices: Choice<Answer<A>>[] = [
      {
        value: noChoice,
        label: t('settings.appearance.useDefault', { value: label(axis, fallback) }),
      },
      ...values.map((value) => ({
        value,
        label: label(axis, value),
        ...(preview === undefined ? {} : { preview: preview(value) }),
      })),
    ];
    const description =
      axis === 'dockEdge'
        ? t('settings.appearance.dockEdge.description')
        : axis === 'motion' && reducedMotion
          ? t('settings.appearance.motion.reduced')
          : undefined;
    return (
      <ChoiceGroup<Answer<A>>
        key={axis}
        legend={t(`settings.appearance.${axis}.legend`)}
        {...(description === undefined ? {} : { description })}
        choices={choices}
        value={preferences[axis] ?? noChoice}
        onChange={(answer) => {
          setCleared(false);
          if (answer === noChoice) appearance.clear(axis);
          else appearance.set(axis, answer);
        }}
      />
    );
  }

  const floatingDock =
    resolved.navNarrow === 'floating-dock' || resolved.navWide === 'floating-dock';
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h2 className="font-display text-page-title">{t('settings.title')}</h2>
      <section aria-labelledby="appearance-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h3 id="appearance-title" className="text-title font-medium">
            {t('settings.appearance.title')}
          </h3>
          <p className="text-muted">{t('settings.appearance.intro')}</p>
        </div>
        {groups
          .filter((axis) => axis !== 'dockEdge' || floatingDock)
          .map((axis) => group(axis, axes[axis].values))}
        <div className="flex flex-col items-start gap-2">
          <Button
            onClick={() => {
              appearance.clearAll();
              // Empty the live region first, so a second click is announced again.
              setCleared(false);
              window.setTimeout(() => {
                setCleared(true);
              }, 100);
            }}
          >
            {t('settings.appearance.clearAll')}
          </Button>
          <p role="status" className="text-small text-muted">
            {cleared ? t('settings.appearance.cleared') : ''}
          </p>
        </div>
      </section>
      <DataExportSection />
      <AccountDeletionSection />
    </div>
  );
}
