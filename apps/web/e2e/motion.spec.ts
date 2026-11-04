import { expect, test, type Page } from '@playwright/test';
import { reportViolations } from './problems.js';

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

/** Adds an element that asks for motion and reads back what the cascade leaves of it. */
async function motionOf(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.transition = 'opacity 300ms ease 100ms';
    probe.style.animation = 'arca-probe 2s linear 50ms infinite';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const result = {
      transitionDuration: style.transitionDuration,
      transitionDelay: style.transitionDelay,
      animationDuration: style.animationDuration,
      animationIterationCount: style.animationIterationCount,
    };
    probe.remove();
    return result;
  });
}

const stopped = {
  transitionDuration: '0s',
  transitionDelay: '0s',
  animationDuration: '0s',
  animationIterationCount: '1',
};

test('keeps motion by default', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  expect(await motionOf(page)).toEqual({
    transitionDuration: '0.3s',
    transitionDelay: '0.1s',
    animationDuration: '2s',
    animationIterationCount: 'infinite',
  });
});

test('stops every transition and animation when motion is off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-motion', 'off');
  });
  expect(await motionOf(page)).toEqual(stopped);
});

test('stops motion when the system asks for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await motionOf(page)).toEqual(stopped);
});

/** Starts a view transition and counts the animations it runs. */
async function viewTransitionAnimations(page: Page) {
  return page.evaluate(async () => {
    const transition = document.startViewTransition(() => {
      document.body.dataset['probe'] = String(Date.now());
    });
    await transition.ready;
    const count = document.getAnimations().length;
    await transition.finished;
    return count;
  });
}

test('animates page view transitions only while motion is on', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  expect(await viewTransitionAnimations(page)).toBeGreaterThan(0);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-motion', 'off');
  });
  expect(await viewTransitionAnimations(page)).toBe(0);
});

test('transitions the properties the menu toggle actually changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  // The same classes MenuToggle uses: Tailwind 4 writes rotate and translate as their own properties.
  const style = await page.evaluate(() => {
    const line = document.createElement('span');
    line.className = 'transition-[translate,rotate,opacity] translate-y-1.5 rotate-45';
    document.body.append(line);
    const computed = getComputedStyle(line);
    const result = {
      transitioned: computed.transitionProperty,
      rotate: computed.rotate,
      transform: computed.transform,
    };
    line.remove();
    return result;
  });
  expect(style.transitioned).toBe('translate, rotate, opacity');
  expect(style.rotate).toBe('45deg');
  expect(style.transform).toBe('none');
});
