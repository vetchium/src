export type PageSize = number;
export type PaginationKey = string;

export function isPageSize(value: PageSize): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 100;
}

export function isPaginationKey(value: PaginationKey): boolean {
  const length = [...value].length;
  return length >= 1 && length <= 4096;
}
