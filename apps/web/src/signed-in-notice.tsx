import { Button } from '@arca/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resetAccount } from './api.js';
import { signOut } from './sign-in.js';

/**
 * A link creates a new account, which a browser signed in to another one cannot do (the API
 * answers 409), so the screen offers to sign out instead of starting the passkey prompt.
 */
export function SignedInNotice({ email }: { readonly email: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'signing-out' | 'failed'>('idle');

  const leave = () => {
    setState('signing-out');
    signOut()
      .then(async () => {
        await resetAccount(queryClient);
        setState('idle');
      })
      .catch(() => {
        setState('failed');
      });
  };

  return (
    <div className="flex flex-col gap-3">
      <p>{t('linkSession.signedIn', { email })}</p>
      <Button
        disabled={state === 'signing-out'}
        aria-busy={state === 'signing-out'}
        onClick={leave}
      >
        {t('linkSession.signOut')}
      </Button>
      <p role="status" className={state === 'failed' ? 'text-ink' : 'text-muted'}>
        {state === 'signing-out'
          ? t('linkSession.signingOut')
          : state === 'failed'
            ? t('linkSession.failure')
            : ''}
      </p>
    </div>
  );
}
