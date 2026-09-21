/**
 * Every open AssemblyAI socket is registered here. Billing is on websocket-open duration and an
 * abandoned session bills three hours, so: every session has a hard ceiling, every exit path ends
 * it, and opens and closes are logged so an imbalance is visible the same day.
 */
export interface Closable {
  readonly id: string;
  close(reason: string): void;
}

export interface RegistryLogEntry {
  at: number;
  event: 'open' | 'close';
  id: string;
  reason?: string;
  durationMs?: number;
}

export class SessionRegistry {
  private open = new Map<string, { session: Closable; openedAt: number; timer: ReturnType<typeof setTimeout> }>();
  readonly log: RegistryLogEntry[] = [];

  constructor(
    private readonly maxSeconds: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  register(session: Closable): void {
    const openedAt = this.now();
    const timer = setTimeout(() => session.close('hard-timeout'), this.maxSeconds * 1000);
    this.open.set(session.id, { session, openedAt, timer });
    this.log.push({ at: openedAt, event: 'open', id: session.id });
  }

  /** Called by the session itself once its socket is closed. Idempotent. */
  released(id: string, reason: string): void {
    const entry = this.open.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.open.delete(id);
    const at = this.now();
    this.log.push({ at, event: 'close', id, reason, durationMs: at - entry.openedAt });
  }

  /** End everything: page unload, unhandled error, Reset. */
  closeAll(reason: string): void {
    for (const { session } of [...this.open.values()]) session.close(reason);
  }

  get openCount(): number {
    return this.open.size;
  }

  /** True when every open in the log has a matching close. */
  get balanced(): boolean {
    return this.log.filter((l) => l.event === 'open').length === this.log.filter((l) => l.event === 'close').length;
  }

  /** Wire the browser exit paths. Returns an unsubscribe. */
  attachToWindow(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
    const onExit = () => this.closeAll('page-exit');
    target.addEventListener('pagehide', onExit);
    target.addEventListener('beforeunload', onExit);
    return () => {
      target.removeEventListener('pagehide', onExit);
      target.removeEventListener('beforeunload', onExit);
    };
  }
}
