import { ApiError } from '@arca/api-contract/client';
import { Button, ChoiceGroup, Icon, menuItemClass, type Choice } from '@arca/ui';
import { axes, type AxisName, type AxisValue } from '@arca/ui/theme/ids';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountDeletionSection, DeletionPendingNotice } from '../account-deletion.js';
import { sessionQuery } from '../api.js';
import { appearance, useAppearance } from '../appearance/store.js';
import { DataExportSection } from '../data-export.js';
import { textLinkClass } from '../forms/text-link.js';
import { NotificationsSection } from '../notifications-section.js';
import { CorrectorKeySection } from '../knowledge/corrector-key.js';
import {
  sectionAxes,
  sectionIcons,
  settingsSearch,
  settingsSections,
  type AxisSection,
  type SettingsSection,
} from '../settings/sections.js';
import { useTourReady } from '../tour/guide.js';
import { seenTours } from '../tour/seen.js';
import { appTour, screenHints } from '../tour/tours.js';

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
  const signedOut = session.error instanceof ApiError && session.error.status === 401;
  const deletionDueAt = session.data?.deletionDueAt;
  return (
    <>
      {signedOut ? (
        <div className="flex flex-col items-start gap-2">
          <p>{t('settings.sections.signIn')}</p>
          <Link to="/sign-in" className={textLinkClass}>
            {t('session.signIn')}
          </Link>
        </div>
      ) : (
        session.isError && (
          <div className="flex flex-col items-start gap-2">
            <p>{t('settings.sections.loadFailure')}</p>
            <Button variant="secondary" onClick={() => void session.refetch()}>
              {t('settings.sections.retry')}
            </Button>
          </div>
        )
      )}
      {typeof deletionDueAt === 'string' && <DeletionPendingNotice dueAt={deletionDueAt} />}
      <NotificationsSection />
      <DataExportSection />
      <AccountDeletionSection />
    </>
  );
}

/** The way to the activation screen, for an admin only (spec 0007, R7). */
function KnowledgePanel() {
  const { t } = useTranslation();
  return (
    <>
      <Link to="/knowledge" className={`${textLinkClass} self-start`}>
        {t('knowledge.settings.open')}
      </Link>
      <CorrectorKeySection />
    </>
  );
}

/** Shows the first-run tour again, or the screens' hints (#123). */
function HelpPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [hintsBack, setHintsBack] = useState(false);
  const ready = useTourReady();
  if (!ready) return <p>{t('settings.help.unavailable')}</p>;
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        onClick={() => {
          seenTours.forget(appTour.id);
          void navigate({ to: appTour.path });
        }}
      >
        {t('settings.help.replayTour')}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          seenTours.forget(...screenHints.map((hint) => hint.id));
          setHintsBack(true);
        }}
      >
        {t('settings.help.replayHints')}
      </Button>
      <p role="status" className="text-small text-muted">
        {hintsBack ? t('settings.help.hintsBack') : ''}
      </p>
    </div>
  );
}

type IntroKey = 'settings.appearance.intro' | 'knowledge.settings.intro' | 'settings.help.intro';

/** What each category shows under its heading; the admins' category only to an admin. */
interface PanelEntry {
  readonly intro?: IntroKey;
  readonly Panel: () => ReactNode;
  readonly adminOnly?: true;
}

const axisPanels = Object.fromEntries(
  (Object.keys(sectionAxes) as AxisSection[]).map((section) => [
    section,
    { intro: 'settings.appearance.intro', Panel: () => <AxisPanel section={section} /> },
  ]),
) as Record<AxisSection, PanelEntry>;

const panels: Record<SettingsSection, PanelEntry> = {
  ...axisPanels,
  account: { Panel: AccountPanel },
  knowledge: { intro: 'knowledge.settings.intro', Panel: KnowledgePanel, adminOnly: true },
  help: { intro: 'settings.help.intro', Panel: HelpPanel },
};

/** Settings in categories: a side menu on wide screens, a row of buttons on top on phones. */
function Settings() {
  const { t } = useTranslation();
  const { section: asked } = Route.useSearch();
  const session = useQuery(sessionQuery);
  const visible = settingsSections.filter(
    (section) => panels[section].adminOnly !== true || session.data?.admin === true,
  );
  const current = asked !== undefined && visible.includes(asked) ? asked : settingsSections[0];
  const { intro, Panel } = panels[current];
  const sectionLabel = (section: SettingsSection) => t(`settings.sections.${section}`);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-display text-page-title">{t('settings.title')}</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label={t('settings.sections.label')}>
          <ul className="flex flex-wrap gap-2 lg:sticky lg:top-4 lg:flex-col lg:gap-1">
            {visible.map((section) => (
              <li key={section}>
                <Link
                  to="/settings"
                  search={{ section }}
                  replace
                  activeOptions={{ exact: true, includeSearch: true }}
                  aria-current={section === current ? 'page' : undefined}
                  data-current={section === current || undefined}
                  className={menuItemClass}
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
            {intro !== undefined && <p className="text-muted">{t(intro)}</p>}
          </div>
          <Panel />
        </section>
      </div>
    </div>
  );
}
