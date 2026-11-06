import { Button, ChoiceGroup, Icon, type Choice } from '@arca/ui';
import { axes, type AxisName, type AxisValue } from '@arca/ui/theme/ids';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountDeletionSection } from '../account-deletion.js';
import { sessionQuery } from '../api.js';
import { appearance, useAppearance } from '../appearance/store.js';
import { DataExportSection } from '../data-export.js';
import { textLinkClass } from '../forms/text-link.js';
import { NotificationsSection } from '../notifications-section.js';
import {
  isAxisSection,
  sectionAxes,
  sectionIcons,
  settingsSearch,
  settingsSections,
  type AxisSection,
  type SettingsSection,
} from '../settings/sections.js';

export const Route = createFileRoute('/settings')({
  validateSearch: settingsSearch,
  component: Settings,
});

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

/** One category's appearance questions, with a reset for those questions only. */
function AxisPanel({ section }: { readonly section: AxisSection }) {
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
  const shown: readonly AxisName[] = sectionAxes[section];
  return (
    <>
      {shown
        .filter((axis) => axis !== 'dockEdge' || floatingDock)
        .map((axis) => group(axis, axes[axis].values))}
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            appearance.clear(...shown);
            // Empty the live region first, so a second click is announced again.
            setCleared(false);
            window.setTimeout(() => {
              setCleared(true);
            }, 100);
          }}
        >
          {t('settings.appearance.clearSection')}
        </Button>
        <p role="status" className="text-small text-muted">
          {cleared ? t('settings.appearance.cleared') : ''}
        </p>
      </div>
    </>
  );
}

/** The account's own settings; a signed-out visitor is asked to sign in. */
function AccountPanel() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  return (
    <>
      {session.isError && (
        <div className="flex flex-col items-start gap-2">
          <p>{t('settings.sections.signIn')}</p>
          <Link to="/sign-in" className={textLinkClass}>
            {t('session.signIn')}
          </Link>
        </div>
      )}
      <NotificationsSection />
      <DataExportSection />
      <AccountDeletionSection />
    </>
  );
}

/** The way to the activation screen, for an approver only (spec 0007, R7). */
function KnowledgePanel() {
  const { t } = useTranslation();
  return (
    <Link to="/knowledge" className={`${textLinkClass} self-start`}>
      {t('knowledge.settings.open')}
    </Link>
  );
}

/** Settings in categories: a side menu on wide screens, a row of buttons on top on phones. */
function Settings() {
  const { t } = useTranslation();
  const { section: asked } = Route.useSearch();
  const session = useQuery(sessionQuery);
  const visible = settingsSections.filter((section) => {
    switch (section) {
      case 'account':
        // A pending deletion leaves nothing here to change; the home page offers the cancel.
        return session.data === undefined || session.data.deletionDueAt === null;
      case 'knowledge':
        return session.data?.approver === true;
      default:
        return true;
    }
  });
  const current = asked !== undefined && visible.includes(asked) ? asked : 'appearance';
  const sectionLabel = (section: SettingsSection) => t(`settings.sections.${section}`);
  const intro = isAxisSection(current)
    ? t('settings.appearance.intro')
    : current === 'knowledge'
      ? t('knowledge.settings.intro')
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-display text-page-title">{t('settings.title')}</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
        <nav aria-label={t('settings.sections.label')}>
          <ul className="flex flex-wrap gap-2 md:sticky md:top-4 md:flex-col md:gap-1">
            {visible.map((section) => (
              <li key={section}>
                <Link
                  to="/settings"
                  search={{ section }}
                  replace
                  activeOptions={{ exact: true, includeSearch: true }}
                  aria-current={section === current ? 'page' : undefined}
                  className="flex min-h-touch items-center gap-2 rounded-control border border-line px-3 font-medium whitespace-nowrap text-muted hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-[current=page]:border-primary aria-[current=page]:bg-soft aria-[current=page]:text-ink md:border-transparent md:aria-[current=page]:border-transparent md:aria-[current=page]:shadow-[inset_3px_0_0_var(--arca-primary)]"
                >
                  <Icon name={sectionIcons[section]} />
                  {sectionLabel(section)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section
          key={current}
          aria-labelledby="settings-section-title"
          className="flex min-w-0 flex-col gap-6"
        >
          <div className="flex flex-col gap-1">
            <h3 id="settings-section-title" className="text-title font-medium">
              {sectionLabel(current)}
            </h3>
            {intro !== undefined && <p className="text-muted">{intro}</p>}
          </div>
          {isAxisSection(current) ? (
            <AxisPanel section={current} />
          ) : current === 'account' ? (
            <AccountPanel />
          ) : (
            <KnowledgePanel />
          )}
        </section>
      </div>
    </div>
  );
}
