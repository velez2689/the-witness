'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { importClaims, isUsable, selectionBlocked, type ImportResult, type ImportedClaim } from '@/domain/claim-import';

/**
 * Worklist state: the file the Agent picked, the rows it produced, and which claims they ticked.
 *
 * The saved worklist is read through an external store rather than restored in an effect, so the
 * server's empty snapshot and the client's saved one resolve during hydration instead of
 * mismatching. Once the Agent touches anything, local state takes over and writes through.
 */

export type ReadWorkbook = (file: File) => Promise<{ rows: string[][]; sheetName: string | null }>;

export interface SavedWorklist {
  fileName: string | null;
  sheetName: string | null;
  claims: ImportedClaim[];
  selected: string[];
  loaded: boolean;
}

/** Structural twin of services/worklist-store, so the UI never imports services. */
export interface WorklistStorage {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): string | null;
  getServerSnapshot(): string | null;
  save(value: SavedWorklist): void;
  clear(): void;
}

const NO_STORE: WorklistStorage = {
  subscribe: () => () => {},
  getSnapshot: () => null,
  getServerSnapshot: () => null,
  save: () => {},
  clear: () => {},
};

const EMPTY: SavedWorklist = { fileName: null, sheetName: null, claims: [], selected: [], loaded: false };

export function useWorklist(readWorkbook: ReadWorkbook | undefined, storage: WorklistStorage = NO_STORE) {
  const raw = useSyncExternalStore(storage.subscribe, storage.getSnapshot, storage.getServerSnapshot);
  const [live, setLive] = useState<SavedWorklist | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = useMemo<SavedWorklist | null>(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SavedWorklist;
    } catch {
      return null;
    }
  }, [raw]);

  const state = live ?? saved ?? EMPTY;

  /** Every change writes through, so a refresh mid-call keeps the roster. */
  const commit = useCallback(
    (next: SavedWorklist) => {
      setLive(next);
      storage.save(next);
    },
    [storage],
  );

  const pick = useCallback(
    async (file: File) => {
      if (!readWorkbook) return;
      setBusy(true);
      setError(null);
      try {
        const { rows, sheetName } = await readWorkbook(file);
        const out = importClaims(rows);
        if (out.error) setError(out.error);
        commit({ fileName: file.name, sheetName, claims: [...out.claims], selected: [], loaded: false });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That file could not be read.');
        setLive(EMPTY);
        storage.clear();
      } finally {
        setBusy(false);
      }
    },
    [commit, readWorkbook, storage],
  );

  const toggle = useCallback(
    (claim: ImportedClaim) => {
      const on = state.selected.includes(claim.claimId);
      if (!on && selectionBlocked(state.selected.length, claim)) return; // the cap is the domain's call
      commit({
        ...state,
        selected: on ? state.selected.filter((id) => id !== claim.claimId) : [...state.selected, claim.claimId],
      });
    },
    [commit, state],
  );

  const clear = useCallback(() => {
    setLive(EMPTY);
    setError(null);
    storage.clear();
  }, [storage]);

  const result: ImportResult | null =
    state.claims.length > 0 || state.fileName ? { claims: state.claims, headerRow: 0, columns: null, error: null } : null;

  return {
    fileName: state.fileName,
    sheetName: state.sheetName,
    selected: state.selected,
    loaded: state.loaded,
    result,
    busy,
    error,
    /** The ticked rows, in sheet order, ready to become the call roster. */
    chosen: state.claims.filter((c) => state.selected.includes(c.claimId) && isUsable(c)),
    pick,
    toggle,
    clear,
    load: useCallback(() => commit({ ...state, loaded: true }), [commit, state]),
  };
}
