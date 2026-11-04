import { useEffect, useState } from 'react';
import { clearFragment, linkTokenFrom } from './enrollment.js';

/**
 * The token of an emailed link, read once from the fragment and then cleared from the address
 * bar (spec 0003, R2). A link opened in a tab already on the page changes only the fragment, so
 * a new one is picked up too. The setter lets a screen drop the token, to ask for a new link.
 */
export function useLinkToken() {
  const [token, setToken] = useState(() => linkTokenFrom(window.location.hash));
  useEffect(() => {
    clearFragment(window.location, window.history);
    const onHashChange = () => {
      const linked = linkTokenFrom(window.location.hash);
      clearFragment(window.location, window.history);
      if (linked !== undefined) setToken(linked);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
  return [token, setToken] as const;
}
