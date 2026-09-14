/**
 * The test oracle for the anchor-day, clamped billing period rule
 * (`agent-guides/hub-subscriptions.md`), mirroring
 * `backend/internal/hub/billing`'s `Boundary` and `PeriodContaining` in
 * TypeScript so Playwright can compute expected period boundaries independently
 * of the implementation under test.
 */

export type BillingInterval = "month" | "year";

function intervalMonths(interval: BillingInterval): number {
  return interval === "year" ? 12 : 1;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function floorDivMod(a: number, b: number): [number, number] {
  const q = Math.floor(a / b);
  const r = a - q * b;
  return [q, r];
}

/**
 * Adds n intervals to anchor's year and month, clamping the day to the
 * target month's last day and preserving the time of day.
 */
export function boundary(
  anchor: Date,
  interval: BillingInterval,
  n: number,
): Date {
  const totalMonths = anchor.getUTCMonth() + n * intervalMonths(interval);
  const [yearOffset, monthIndex] = floorDivMod(totalMonths, 12);
  const year = anchor.getUTCFullYear() + yearOffset;
  const day = Math.min(anchor.getUTCDate(), lastDayOfMonth(year, monthIndex));
  return new Date(
    Date.UTC(
      year,
      monthIndex,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

export interface BoundaryPair {
  anchor: Date;
  start: Date;
  end: Date;
}

/**
 * Finds an anchor whose period ends exactly at `end`, searching backward in
 * whole intervals for the first candidate whose day of month exists in the
 * target month without clamping. A committed test period can therefore end
 * at any chosen instant and still pass `StateFromStored`'s boundary-pair
 * check.
 */
export function boundaryPairEndingAt(
  end: Date,
  interval: BillingInterval,
): BoundaryPair {
  const maxK = interval === "year" ? 8 : 2;
  const day = end.getUTCDate();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  for (let k = 1; k <= maxK; k++) {
    let candidateYear: number;
    let candidateMonth: number;
    if (interval === "year") {
      candidateYear = endYear - k;
      candidateMonth = endMonth;
    } else {
      const [yearOffset, monthIndex] = floorDivMod(endMonth - k, 12);
      candidateYear = endYear + yearOffset;
      candidateMonth = monthIndex;
    }
    if (day > lastDayOfMonth(candidateYear, candidateMonth)) continue;
    const anchor = new Date(
      Date.UTC(
        candidateYear,
        candidateMonth,
        day,
        end.getUTCHours(),
        end.getUTCMinutes(),
        end.getUTCSeconds(),
        end.getUTCMilliseconds(),
      ),
    );
    return {
      anchor,
      start: boundary(anchor, interval, k - 1),
      end: boundary(anchor, interval, k),
    };
  }
  throw new Error(
    `no unclamped anchor found within ${maxK} steps before ${end.toISOString()}`,
  );
}
