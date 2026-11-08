import { Badge, Flex, theme } from "antd";
import type { ReactNode } from "react";

/**
 * How often what waits on the user is read again: navigation badges and inbox
 * lists every minute, the conversation on screen every 15 seconds, and both
 * whenever the window regains focus (never stale, so focus always reads).
 * Polling pauses while the tab is hidden.
 */
export const inboxRefresh = {
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
  staleTime: 0,
} as const;

export const openConversationRefresh = {
  refetchInterval: 15_000,
  refetchOnWindowFocus: true,
  staleTime: 0,
} as const;

/**
 * One navigation count. `action` is something to decide (a request to
 * answer) and shows solid; `unread` is something to read and shows outlined,
 * so the two differ by shape as well as color.
 */
export interface NavigationCount {
  kind: "action" | "unread";
  count: number;
  /** Read by screen readers in place of the number, e.g. "2 unread". */
  label: string;
}

/**
 * A navigation item's text followed by its non-zero counts. The badges are
 * hidden from assistive technology; each count's label is read instead.
 */
export function NavigationLabel({
  children,
  counts,
}: {
  children: ReactNode;
  counts: readonly NavigationCount[];
}): ReactNode {
  const { token } = theme.useToken();
  const shown = counts.filter((item) => item.count > 0);
  if (shown.length === 0) return children;
  return (
    <Flex align="center" justify="space-between" gap="small">
      <span>{children}</span>
      <Flex align="center" gap={4}>
        {shown.map((item) => (
          <span key={item.kind} data-testid={`navigation-count-${item.kind}`}>
            <Badge
              count={item.count}
              size="small"
              title={item.label}
              aria-hidden
              styles={{
                // colorErrorActive keeps white text at 4.5:1 or more in the
                // light and dark algorithms; colorError does not.
                indicator:
                  item.kind === "action"
                    ? {
                        backgroundColor: token.colorErrorActive,
                        color: token.colorTextLightSolid,
                      }
                    : {
                        backgroundColor: token.colorBgContainer,
                        color: token.colorText,
                        boxShadow: `0 0 0 1px ${token.colorTextSecondary}`,
                      },
              }}
            />
            <span className="visually-hidden">{item.label}</span>
          </span>
        ))}
      </Flex>
    </Flex>
  );
}
