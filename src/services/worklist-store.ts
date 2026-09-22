import type { ImportedClaim } from '@/domain/claim-import';

/**
 * The worklist the Agent picked, kept in browser storage so a refresh mid-call does not lose it.
 *
 * Modelled as an external store rather than state restored in an effect, because that is what it
 * is: the server has no localStorage, so it renders the empty snapshot and the client swaps in
 * the saved one on hydration. Restoring inside an effect would either mismatch hydration or
 * cascade an extra render.
 *
 * Per-browser and per-origin. It never leaves the machine and is never sent anywhere.
 */

const KEY = 'witness.worklist.v1';

export interface SavedWorklist {
  fileName: string | null;
  sheetName: string | null;
  claims: ImportedClaim[];
  selected: string[];
  loaded: boolean;
}

export interface WorklistStore {
  subscribe(onChange: () => void): () => void;
  /** Raw JSON, so React can compare snapshots by identity without re-parsing every render. */
  getSnapshot(): string | null;
  getServerSnapshot(): string | null;
  save(value: SavedWorklist): void;
  clear(): void;
}

export function createWorklistStore(): WorklistStore {
  const listeners = new Set<() => void>();
  // Cached so getSnapshot returns a stable value; localStorage would otherwise be read every render.
  let cached: string | null | undefined;

  const emit = (): void => {
    for (const l of listeners) l();
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      // Another tab editing the same worklist should be reflected here.
      const onStorage = (e: StorageEvent): void => {
        if (e.key === KEY) {
          cached = undefined;
          onChange();
        }
      };
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(onChange);
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot() {
      if (cached !== undefined) return cached;
      try {
        cached = localStorage.getItem(KEY);
      } catch {
        // Private window, or site data blocked. The call must still work.
        cached = null;
      }
      return cached;
    },
    getServerSnapshot() {
      return null;
    },
    save(value) {
      const raw = JSON.stringify(value);
      cached = raw;
      try {
        localStorage.setItem(KEY, raw);
      } catch {
        /* storage is a convenience, never a requirement */
      }
      emit();
    },
    clear() {
      cached = null;
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* as above */
      }
      emit();
    },
  };
}
