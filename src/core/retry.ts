// Bounded retry for an attempt that can come back "busy" (a form shown while the player has chat
// open is cancelled with UserBusy, technical design §2.8).

/** Returns the first result that is not busy, or undefined after `tries` busy results. */
export async function retryWhileBusy<T>(
  attempt: () => Promise<T>,
  isBusy: (result: T) => boolean,
  wait: () => Promise<unknown>,
  tries: number,
): Promise<T | undefined> {
  for (let i = 0; i < tries; i += 1) {
    if (i > 0) await wait(); // eslint-disable-line no-await-in-loop -- retries are sequential
    const result = await attempt(); // eslint-disable-line no-await-in-loop -- as above
    if (!isBusy(result)) return result;
  }
  return undefined;
}
