import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import type { PaginationKey } from "typespec/common/pagination";

/** The URL parameters the Applicants and Candidates tabs keep. */
export const listParams = [
  "q",
  "view",
  "stage",
  "only",
  "pending",
  "routed",
] as const;

/**
 * One list's filters live in the URL so reload, back, and shared links keep
 * them; the keyset pages cannot, so they restart whenever a filter changes.
 */
export function useListState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pages, setPages] = useState<{
    keys: Array<PaginationKey | undefined>;
    index: number;
  }>({ keys: [undefined], index: 0 });
  const get = (name: string) => searchParams.get(name) ?? undefined;
  const set = useCallback(
    (changes: Record<string, string | undefined>) => {
      setPages({ keys: [undefined], index: 0 });
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [name, value] of Object.entries(changes)) {
            if (value === undefined || value === "") next.delete(name);
            else next.set(name, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  return {
    get,
    set,
    paginationKey: pages.keys[pages.index],
    pageIndex: pages.index,
    previous: () => setPages((old) => ({ ...old, index: old.index - 1 })),
    next: (key: PaginationKey) =>
      setPages((old) => ({
        keys: [...old.keys.slice(0, old.index + 1), key],
        index: old.index + 1,
      })),
  };
}
