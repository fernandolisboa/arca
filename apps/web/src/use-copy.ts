import { useEffect, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

/** Copies the text to the clipboard; `copied` falls back to `idle` after two seconds. */
export function useCopy(text: string) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => {
      setState('idle');
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = () => {
    // Inside the promise, so a browser without the clipboard API lands in `failed` too.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => {
          setState('copied');
        },
        () => {
          setState('failed');
        },
      );
  };

  return { state, copy };
}
