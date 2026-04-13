export function createLimiter(maxConcurrency: number) {
  if (maxConcurrency <= 0 || Number.isNaN(maxConcurrency)) {
    return async <T>(task: () => Promise<T>): Promise<T> => task();
  }

  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= maxConcurrency) return;
    const task = queue.shift();
    if (task) {
      task();
    }
  };

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active += 1;
        task()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active -= 1;
            next();
          });
      };

      if (active < maxConcurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}
