/**
 * Graceful-shutdown seam. pg-boss consumption (WP-02) registers its stop
 * handler here so an in-flight job finishes before the process exits -
 * jobs on clinical paths must never be killed mid-transaction (ADR-0008).
 */

export type StopHandler = () => Promise<void> | void;

export function createLifecycle(): {
  onStop: (handler: StopHandler) => void;
  shutdown: () => Promise<void>;
  readonly stopped: boolean;
} {
  const handlers: StopHandler[] = [];
  let stopped = false;

  return {
    onStop(handler: StopHandler): void {
      handlers.push(handler);
    },
    async shutdown(): Promise<void> {
      if (stopped) return;
      stopped = true;
      // Reverse order: last-registered (most-derived) resources close first.
      for (const handler of handlers.reverse()) {
        await handler();
      }
    },
    get stopped(): boolean {
      return stopped;
    },
  };
}
