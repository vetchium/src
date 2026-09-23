import { DatePicker } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type { ProfileMonth } from "typespec/hub/profile/public";

/** The oldest month PROF-EXP-004 / PROF-EDU-004 allow. */
const earliestMonth = dayjs("1900-01", "YYYY-MM");

function toDayjs(value?: ProfileMonth): Dayjs | undefined {
  return value === undefined ? undefined : dayjs(value, "YYYY-MM");
}

function toProfileMonth(value: Dayjs | null): ProfileMonth | undefined {
  return value === null ? undefined : value.format("YYYY-MM");
}

/**
 * A month-and-year picker bound to the wire's "YYYY-MM" string, bounded to
 * the January 1900 .. current UTC month range every profile month field
 * shares (PROF-EXP-004, PROF-EDU-004).
 */
export function MonthSelect({
  id,
  value,
  onChange,
  allowClear,
  disabled,
  ariaLabel,
}: {
  id?: string;
  value?: ProfileMonth;
  onChange?: (value: ProfileMonth | undefined) => void;
  allowClear?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <DatePicker
      id={id}
      aria-label={ariaLabel}
      picker="month"
      className="full-width"
      value={toDayjs(value)}
      allowClear={allowClear}
      disabled={disabled}
      minDate={earliestMonth}
      maxDate={dayjs()}
      onChange={(next) => onChange?.(toProfileMonth(next))}
    />
  );
}
