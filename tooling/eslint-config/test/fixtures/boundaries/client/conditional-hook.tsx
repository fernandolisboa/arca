import { useState } from 'react';

export function useMaybe(enabled: boolean) {
  if (enabled) {
    return useState(0);
  }
  return undefined;
}
