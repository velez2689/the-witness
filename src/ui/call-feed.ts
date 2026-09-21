import type { CallEvent } from '@/domain/mode-a';
import type { CopilotEvent } from '@/domain/mode-b';
import type { Contradiction } from '@/domain/contradiction';
import type { Statement } from '@/domain/statement';
import { estimateDurationMs } from '@/domain/script';

/** One row of the live transcript, whichever mode produced it. */
export interface FeedItem {
  id: string;
  side: 'rep' | 'witness' | 'agent' | 'whisper' | 'closeout';
  text: string;
  atMs: number;
  durationMs: number;
  holdSeconds: number;
  cites: readonly string[];
  added: readonly Statement[];
  contradictions: readonly Contradiction[];
  engineMs: number | null;
  lowConfidence: boolean;
  /** Mode A: what the plan was doing. Mode B whisper: what triggered it. */
  tag: string | null;
}

export function fromModeA(events: readonly CallEvent[]): FeedItem[] {
  return events.map((e, i) =>
    e.type === 'witness'
      ? {
          id: `a-${i}`,
          side: 'witness' as const,
          text: e.text,
          atMs: e.atMs,
          durationMs: estimateDurationMs(e.text),
          holdSeconds: 0,
          cites: e.cites,
          added: [],
          contradictions: [],
          engineMs: null,
          lowConfidence: false,
          tag: e.move.key,
        }
      : {
          id: `a-${i}`,
          side: 'rep' as const,
          text: e.line.text,
          atMs: e.atMs,
          durationMs: estimateDurationMs(e.line.text),
          holdSeconds: e.line.holdBeforeSeconds ?? 0,
          cites: [],
          added: e.added,
          contradictions: e.contradictions,
          engineMs: e.engineMs,
          lowConfidence: e.line.lowConfidence ?? false,
          tag: null,
        },
  );
}

export function fromModeB(events: readonly CopilotEvent[]): FeedItem[] {
  return events.map((e, i) => {
    const base = {
      id: `b-${i}`,
      atMs: e.atMs,
      cites: [] as readonly string[],
      added: [] as readonly Statement[],
      contradictions: [] as readonly Contradiction[],
      engineMs: null as number | null,
      lowConfidence: false,
      tag: null as string | null,
      holdSeconds: 0,
    };
    switch (e.type) {
      case 'agent':
        return { ...base, side: 'agent' as const, text: e.text, durationMs: estimateDurationMs(e.text) };
      case 'rep':
        return {
          ...base,
          side: 'rep' as const,
          text: e.text,
          durationMs: estimateDurationMs(e.text),
          holdSeconds: e.holdBeforeSeconds,
          added: e.added,
          contradictions: e.contradictions,
          engineMs: e.engineMs,
        };
      case 'whisper':
        return { ...base, side: 'whisper' as const, text: e.text, durationMs: 1800, cites: e.cites, tag: e.reason };
      case 'closeout':
        return { ...base, side: 'closeout' as const, text: e.text, durationMs: 4000, cites: e.cites };
    }
  });
}

export { clockLabel, holdLabel } from '@/lib/time';
