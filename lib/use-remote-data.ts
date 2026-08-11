"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RemoteState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Loads JSON for a screen and always reaches a terminal state.
 *
 * A screen must never be able to sit on a spinner forever: if a request is
 * superseded by a newer one the newer one still settles, and if every attempt
 * fails the caller gets an error it can show with a retry. Requests are aborted
 * on unmount so a stale response cannot overwrite a fresh screen.
 */
export function useRemoteData<T>(url: string, fallbackMessage: string): RemoteState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const ticket = latest.current + 1;
    latest.current = ticket;
    let settled = false;

    (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (ticket !== latest.current) return; // a newer request owns the screen
        if (!response.ok) throw new Error(payload?.error || fallbackMessage);
        settled = true;
        setData(payload as T);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted || ticket !== latest.current) return;
        settled = true;
        setError(caught instanceof Error ? caught.message : fallbackMessage);
      } finally {
        if (settled) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [url, fallbackMessage, attempt]);

  return { data, error, loading, reload };
}
