type LogCtx = Record<string, unknown> & { stage?: string; jobId?: string; domain?: string };

export function createLogger(base: LogCtx = {}) {
  const log = (level: 'info' | 'warn' | 'error', ctx: LogCtx, msg: string) => {
    const line = { level, time: new Date().toISOString(), ...base, ...ctx, msg };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  };
  return {
    info: (ctx: LogCtx, msg: string) => log('info', ctx, msg),
    warn: (ctx: LogCtx, msg: string) => log('warn', ctx, msg),
    error: (ctx: LogCtx, msg: string) => log('error', ctx, msg)
  };
}
