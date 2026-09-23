export type ProfessionalDomain = string;

export function normalizeProfessionalDomain(
  value: ProfessionalDomain,
): ProfessionalDomain {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isProfessionalDomain(value: ProfessionalDomain): boolean {
  const normalized = normalizeProfessionalDomain(value);
  if (normalized.length < 3 || normalized.length > 253) return false;
  const labels = normalized.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    return false;
  }
  if (
    labels.length === 4 &&
    labels.every(
      (label) =>
        /^\d{1,3}$/.test(label) &&
        (label === "0" || !label.startsWith("0")) &&
        Number(label) <= 255,
    )
  ) {
    return false;
  }
  return true;
}
