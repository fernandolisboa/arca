/** The system block every Claude call sends: the instructions, closed by the one cache breakpoint. */
export const cachedSystemBlock = (instructions: string) => ({
  type: 'text',
  text: instructions,
  cache_control: { type: 'ephemeral', ttl: '1h' },
});
