import { useEffect } from "react";

export function prefixedTitle(title: string, prefix: string): string {
  return title.startsWith(prefix) ? title : `${prefix}${title}`;
}

export function unprefixedTitle(title: string, prefix: string): string {
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

/**
 * Keeps `prefix` (such as "(3) ") in front of the document title, so a
 * background tab shows what waits on the user. Pages own their `<title>` and
 * replace it on every navigation, so the prefix is reapplied whenever the head
 * changes and removed when it changes or the shell unmounts.
 */
export function useDocumentTitlePrefix(prefix: string | undefined): void {
  useEffect(() => {
    if (prefix === undefined || prefix === "") return;
    const apply = () => {
      const next = prefixedTitle(document.title, prefix);
      if (next !== document.title) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      document.title = unprefixedTitle(document.title, prefix);
    };
  }, [prefix]);
}
