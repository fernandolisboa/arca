import type { Locator } from '@playwright/test';

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Chooses a country in a country field: opens its picker, searches by name and takes the match. */
export async function pickCountry(scope: Locator, label: string, country: string) {
  // The field's name is its label followed by what is chosen.
  await scope.getByRole('button', { name: new RegExp(`^${escaped(label)} `) }).click();
  const picker = scope.page().getByRole('dialog', { name: label, exact: true });
  await picker.getByRole('searchbox').fill(country);
  await picker.getByRole('button', { name: country, exact: true }).click();
}
