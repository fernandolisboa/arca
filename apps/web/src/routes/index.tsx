import type { CaseView } from '@arca/api-contract/client';
import { Button, Icon, buttonClass, cardClass as card, type IconName } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  caseQuery,
  caseQuestionsQuery,
  healthQuery,
  knowledgeVersionsQuery,
  recoveryKitQuery,
  sessionQuery,
} from '../api.js';
import { DeletionPendingNotice } from '../account-deletion.js';
import { textLinkClass } from '../forms/text-link.js';
import { dayPart, nextStep, stages, type NextStep, type Stage } from '../home/next-step.js';
import { useDateFormat } from '../use-date-format.js';

export const Route = createFileRoute('/')({ component: Home });

const column = 'mx-auto flex w-full max-w-[1120px] flex-col gap-8 sm:gap-10';
const heroTitle =
  'font-display text-hero tracking-tight break-words hyphens-auto sm:text-[3rem] sm:leading-[1.05]';
const primaryLink = `${buttonClass('primary')} self-start`;
const cardLink = `${textLinkClass} mt-auto`;
const noticeLink = `${textLinkClass} text-warn-ink decoration-warn-ink`;

const nextLinks = {
  family: '/family',
  questions: '/family/questions',
  routes: '/family/results',
} as const satisfies Record<Stage, string>;

/** The home (spec 0006, revised 2026-11-06): where the case stands, then the way into each area. */
function Home() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  if (session.isPending) return null;
  if (!session.isSuccess) return <SignedOut />;
  const { data } = session;
  if (data.deletionDueAt !== null || data.recoveryPending) {
    return (
      <div className={column}>
        <p>{t('session.signedIn', { email: data.email })}</p>
        {data.recoveryPending && <RecoveryPendingNotice />}
        {data.deletionDueAt !== null && <DeletionPendingNotice dueAt={data.deletionDueAt} />}
      </div>
    );
  }
  return (
    <div className={column}>
      {data.pendingPasskeyUntil !== null && (
        <PendingPasskeyNotice activeFrom={data.pendingPasskeyUntil} />
      )}
      <KitNotice />
      {data.confirmed ? (
        <Overview approver={data.approver} />
      ) : (
        <>
          <Greeting name={undefined} lead={undefined} />
          <p className="text-warn-ink">{t('session.unconfirmed')}</p>
          <Shortcuts>
            <VaultCard />
          </Shortcuts>
        </>
      )}
      <Footer email={data.email} />
    </div>
  );
}

function SignedOut() {
  const { t } = useTranslation();
  return (
    <div className={column}>
      <section className="flex flex-col items-start gap-4 pt-4">
        <h2 className={`${heroTitle} max-w-3xl`}>{t('app.description')}</h2>
        <p className="text-lead text-muted">{t('home.signedOut')}</p>
        <Link to="/sign-in" className={primaryLink}>
          {t('session.signIn')}
          <Icon name="next" size={18} />
        </Link>
      </section>
      <Footer email={undefined} />
    </div>
  );
}

/** The signed-in, confirmed home. */
function Overview({ approver }: { readonly approver: boolean }) {
  const familyCase = useQuery(caseQuery);
  const view = familyCase.data?.case;
  const questions = useQuery({
    ...caseQuestionsQuery,
    enabled: view !== undefined && view !== null,
  });
  const name = view?.people.find((person) => person.id === view.me)?.displayName;
  const step = view === undefined ? undefined : nextStep(view, questions.data);
  return (
    <>
      <Greeting name={name} lead={step?.stage} />
      {step !== undefined && <NextStepCard step={step} />}
      <Shortcuts>
        <VaultCard />
        <FamilyCard view={view} />
        {approver && <RulesCard />}
      </Shortcuts>
    </>
  );
}

function Shortcuts({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('home.shortcuts')}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-5"
    >
      {children}
    </section>
  );
}

function Greeting({
  name,
  lead,
}: {
  readonly name: string | undefined;
  readonly lead: Stage | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [now] = useState(() => new Date());
  const part = dayPart(now.getHours());
  const date = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return (
    <section className="flex flex-col gap-2 pt-2">
      <p className="text-small font-medium text-muted first-letter:uppercase">{date}</p>
      <h2 className={heroTitle}>
        {name === undefined
          ? t('home.greeting', { part })
          : t('home.greetingNamed', { part, name })}
      </h2>
      {lead !== undefined && (
        <p className="max-w-xl text-lead text-muted">{t(`home.lead.${lead}`)}</p>
      )}
    </section>
  );
}

function NextStepCard({ step }: { readonly step: NextStep }) {
  const { t } = useTranslation();
  const current = stages.indexOf(step.stage);
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={`${card} flex flex-wrap gap-8 p-6 sm:gap-10 sm:p-8`}
    >
      <div className="flex min-w-0 flex-[3_1_20rem] flex-col gap-3">
        <p className="text-small font-semibold tracking-wide text-accent uppercase">
          {t('home.nextStep')}
        </p>
        <h3 id={titleId} className="font-display text-page-title tracking-tight">
          {t(`home.next.${step.stage}.title`)}
        </h3>
        <p className="max-w-xl text-muted">
          {t(`home.next.${step.stage}.body`, { left: step.total - step.answered })}
        </p>
        <Link to={nextLinks[step.stage]} className={`${primaryLink} mt-3`}>
          {t(`home.next.${step.stage}.action`)}
          <Icon name="next" size={18} />
        </Link>
      </div>
      <ol
        aria-label={t('home.stages.label')}
        className="flex min-w-0 flex-[2_1_16rem] flex-col gap-1 self-center"
      >
        {stages.map((stage, index) => (
          <StageRow
            key={stage}
            label={t(`home.stages.${stage}`)}
            position={index + 1}
            state={index < current ? 'done' : index === current ? 'current' : 'later'}
            progress={
              stage === 'questions' && index === current && step.total > 0
                ? t('home.stages.progress', { answered: step.answered, total: step.total })
                : undefined
            }
          />
        ))}
      </ol>
    </section>
  );
}

const badges = {
  done: 'bg-primary text-on-primary',
  current: 'border-2 border-accent font-bold text-accent',
  later: 'border border-line text-muted',
} as const;

function StageRow({
  label,
  position,
  state,
  progress,
}: {
  readonly label: string;
  readonly position: number;
  readonly state: keyof typeof badges;
  readonly progress: string | undefined;
}) {
  const { t } = useTranslation();
  const current = state === 'current';
  return (
    <li
      aria-current={current ? 'step' : undefined}
      className={`flex items-center gap-3 rounded-control px-3 py-2.5 ${current ? 'border border-line bg-soft' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-small ${badges[state]}`}
      >
        {state === 'done' ? <Icon name="check" size={16} /> : position}
      </span>
      <span className={`flex-1 ${current ? 'font-semibold' : 'text-muted'}`}>
        {label}
        {state === 'done' && <span className="sr-only"> {t('home.stages.done')}</span>}
      </span>
      {progress !== undefined && (
        <span className="text-small font-semibold text-accent">{progress}</span>
      )}
    </li>
  );
}

function ShortcutCard({
  icon,
  title,
  figure,
  children,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly figure?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <article className={`${card} flex flex-col gap-2.5 p-6 sm:p-7`}>
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-control border border-line bg-soft text-ink"
      >
        <Icon name={icon} />
      </span>
      <h3 className="mt-1.5 text-lead font-semibold tracking-tight">{title}</h3>
      {figure}
      {children}
    </article>
  );
}

function Figure({ value, unit }: { readonly value: number; readonly unit: string }) {
  return (
    <p className="font-display text-page-title tracking-tight">
      <span className="font-numeric">{value}</span>{' '}
      <span className="font-sans text-body font-medium tracking-normal text-muted">{unit}</span>
    </p>
  );
}

function VaultCard() {
  const { t } = useTranslation();
  return (
    <ShortcutCard icon="vault" title={t('home.vault.title')}>
      <p className="text-muted">{t('home.vault.body')}</p>
      <Link to="/vault" className={cardLink}>
        {t('home.vault.open')}
      </Link>
    </ShortcutCard>
  );
}

function FamilyCard({ view }: { readonly view: CaseView | null | undefined }) {
  const { t } = useTranslation();
  if (view === undefined || view === null) {
    return (
      <ShortcutCard icon="family" title={t('home.family.title')}>
        {view === null && <p className="text-muted">{t('home.family.empty')}</p>}
        <Link to="/invites" className={cardLink}>
          {t('home.family.invite')}
        </Link>
      </ShortcutCard>
    );
  }
  const count = view.people.length;
  const withAccount = view.people.filter(
    (person) => person.id !== view.me && person.accountId !== null,
  ).length;
  return (
    <ShortcutCard
      icon="family"
      title={t('home.family.title')}
      figure={<Figure value={count} unit={t('home.family.people', { count })} />}
    >
      <p className="text-muted">{t('home.family.accounts', { count: withAccount })}</p>
      <Link to="/invites" className={cardLink}>
        {t('home.family.invite')}
      </Link>
    </ShortcutCard>
  );
}

function RulesCard() {
  const { t } = useTranslation();
  const versions = useQuery(knowledgeVersionsQuery);
  const pending = versions.data?.versions.filter((version) => version.state === 'proposed').length;
  return (
    <ShortcutCard
      icon="knowledge"
      title={t('home.rules.title')}
      figure={
        pending === undefined ? undefined : (
          <Figure value={pending} unit={t('home.rules.pending', { count: pending })} />
        )
      }
    >
      <p className="text-muted">{t('home.rules.body')}</p>
      <Link to="/knowledge" className={cardLink}>
        {t('home.rules.open')}
      </Link>
    </ShortcutCard>
  );
}

/** Who is signed in, devices and the service status sit at the foot, out of the case's way. */
function Footer({ email }: { readonly email: string | undefined }) {
  const { t } = useTranslation();
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5 text-small">
      {email !== undefined && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <p className="text-muted">{t('session.signedIn', { email })}</p>
          <Link to="/devices" className={textLinkClass}>
            {t('session.devices')}
          </Link>
        </div>
      )}
      <section aria-labelledby="health-title" className="flex flex-wrap items-center gap-3">
        <h2 id="health-title" className="sr-only">
          {t('health.title')}
        </h2>
        <HealthStatus />
      </section>
    </footer>
  );
}

function HealthStatus() {
  const { t } = useTranslation();
  const health = useQuery(healthQuery);
  // One live region whose text changes, so screen readers announce each new state.
  const [message, tone, dot] = health.isPending
    ? [t('health.checking'), 'text-muted', 'bg-second']
    : health.isError
      ? [t('health.unreachable'), 'text-danger-ink', 'bg-danger-ink']
      : health.data.status === 'ok'
        ? [t('health.status', { status: health.data.status }), 'text-ok-ink', 'bg-ok-ink']
        : [t('health.status', { status: health.data.status }), 'text-warn-ink', 'bg-warn-ink'];
  return (
    <>
      <p role="status" className={`flex items-center gap-2 ${tone}`}>
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
        {message}
      </p>
      {health.isError && (
        <Button
          variant="secondary"
          disabled={health.isFetching}
          aria-busy={health.isFetching}
          onClick={() => void health.refetch()}
        >
          {t('health.retry')}
        </Button>
      )}
    </>
  );
}

/** A warning strip across the top of the home, in the warn colors. */
function Notice({ text, children }: { readonly text: string; readonly children: ReactNode }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-line bg-warn-bg px-4 py-2 text-warn-ink"
    >
      <Icon name="alert" size={18} />
      <p id={titleId} className="min-w-0 flex-[1_1_16rem] font-medium">
        {text}
      </p>
      {children}
    </section>
  );
}

/** Until the recovery kit is saved, losing every passkey would lock the account (spec 0003, R6). */
function KitNotice() {
  const { t } = useTranslation();
  const kit = useQuery(recoveryKitQuery);
  if (!kit.isSuccess || kit.data.status === 'saved') return null;
  return (
    <Notice text={t('session.kitPending')}>
      <Link to="/recovery-kit" className={noticeLink}>
        {t('session.kitLink')}
      </Link>
    </Notice>
  );
}

/**
 * While a recovery passkey waits, every session of the account can only show this and cancel
 * the recovery from the device list (spec 0003, R6).
 */
function RecoveryPendingNotice() {
  const { t } = useTranslation();
  return (
    <Notice text={t('session.recoveryPending')}>
      <Link to="/devices" className={noticeLink}>
        {t('session.recoveryLink')}
      </Link>
    </Notice>
  );
}

/** Every session of the account sees a passkey added while it waits (spec 0003, R4). */
function PendingPasskeyNotice({ activeFrom }: { readonly activeFrom: string }) {
  const { t } = useTranslation();
  const when = useDateFormat();
  return (
    <Notice text={t('session.pendingPasskey', { activeFrom: when.format(new Date(activeFrom)) })}>
      <Link to="/devices" className={noticeLink}>
        {t('session.pendingLink')}
      </Link>
    </Notice>
  );
}
