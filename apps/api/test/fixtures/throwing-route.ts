// A route that fails outside the API's Hono app, to test Nitro's error path.
export default {
  fetch: (): Response => {
    throw new Error('synthetic detail that must not be logged');
  },
};
