import { useEffect, useState } from 'react';
import { passkeys } from './platform.js';

/** Whether this device can create and use passkeys; undefined until it answers. */
export function usePasskeyAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean>();
  useEffect(() => {
    let current = true;
    void passkeys.isAvailable().then((supported) => {
      if (current) setAvailable(supported);
    });
    return () => {
      current = false;
    };
  }, []);
  return available;
}
