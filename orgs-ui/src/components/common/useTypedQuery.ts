import { useEffect, useState } from "react";

const settleMs = 250;

/**
 * The trimmed text typed into an autocomplete, once typing pauses; undefined
 * while it is empty. Clearing the text applies at once, so the suggestions
 * for a fresh search never show the previous search's matches. The third
 * element is the text as typed, for filtering suggestions already held; the
 * fourth is whether the query has yet to catch up with it.
 */
export function useTypedQuery(): [
  string | undefined,
  (value: string) => void,
  string,
  boolean,
] {
  const [typed, setTyped] = useState("");
  const [settled, setSettled] = useState<string>();
  useEffect(() => {
    const trimmed = typed.trim();
    if (trimmed === "") {
      setSettled(undefined);
      return;
    }
    const timer = setTimeout(() => setSettled(trimmed), settleMs);
    return () => clearTimeout(timer);
  }, [typed]);
  return [settled, setTyped, typed, (settled ?? "") !== typed.trim()];
}
