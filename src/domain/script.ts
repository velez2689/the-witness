/** Shape of a scripted call (the demo corpus lives in fixtures/scripts). Pure data, no I/O. */
export interface ScriptLine {
  who: 'REP' | 'US';
  text: string;
  /** Emulates degraded audio: the STT is not sure of an alphanumeric on this line. */
  lowConfidence?: boolean;
  /** A hold in seconds occurring before this line. Trimmed to a marker in the audio. */
  holdBeforeSeconds?: number;
}

export interface ScriptCall {
  id: string;
  number: number;
  startedAt: string;
  durationSeconds: number;
  holdSeconds: number;
  repFirstName: string | null;
  /** Surname the Agent noted for this rep. Spoken names carry only a first name and a badge. */
  repSurname: string | null;
  repBadge: string | null;
  referenceNumber: string | null;
  lines: ScriptLine[];
}

const CHARS_PER_SECOND = 14;
const PAUSE_MS = 400;

/** Estimated speaking time of a line, used until real audio offsets exist. */
export function estimateDurationMs(text: string): number {
  return Math.round((text.length / CHARS_PER_SECOND) * 1000) + PAUSE_MS;
}

export interface TimedLine extends ScriptLine {
  startMs: number;
  endMs: number;
}

/** Lays lines on a compressed timeline: holds are a marker, not elapsed audio. */
export function timeLines(lines: readonly ScriptLine[]): TimedLine[] {
  let cursor = 0;
  return lines.map((line) => {
    const startMs = cursor;
    const endMs = startMs + estimateDurationMs(line.text);
    cursor = endMs;
    return { ...line, startMs, endMs };
  });
}
