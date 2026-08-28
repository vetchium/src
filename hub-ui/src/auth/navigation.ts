export function safeReturnTo(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}
