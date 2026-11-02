import type { ReactNode } from 'react';

export interface AppShellProps {
  /** Shown in the header bar. */
  readonly title: ReactNode;
  readonly skipToContentLabel: string;
  readonly children: ReactNode;
}

const mainId = 'main-content';

/**
 * The page frame: clear of notches and home indicators through the safe-area insets, one column
 * from 320 px phones to desktop widths, and a skip link for keyboard users.
 */
export function AppShell({ title, skipToContentLabel, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] font-sans text-ink">
      <a
        href={`#${mainId}`}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-10 focus:inline-flex focus:min-h-touch focus:items-center focus:rounded-md focus:bg-brand focus:px-4 focus:text-on-brand"
      >
        {skipToContentLabel}
      </a>
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex min-h-touch w-full max-w-5xl items-center px-4 py-2 sm:px-6">
          {title}
        </div>
      </header>
      <main id={mainId} tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
