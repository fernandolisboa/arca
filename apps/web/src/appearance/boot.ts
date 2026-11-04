/*
 * Runs in <head> before first paint (spec 0006, R7), as a classic same-origin script after the
 * stylesheet: applies the stored appearance, or the defaults on any failure.
 */
import { applyPreferences, parsePreferences, storageKey, syncThemeColor } from './preferences.js';

const root = document.documentElement;
try {
  applyPreferences(root, parsePreferences(localStorage.getItem(storageKey)));
} catch {
  applyPreferences(root, {});
}
try {
  syncThemeColor(document);
} catch {
  // The static default in index.html stays.
}
