/** Splits pasted text into distinct addresses: comma, semicolon, or any
 * whitespace separates them. Comparison ignores case; the first spelling
 * wins, and the server normalizes it. */
export function parseAddresses(text: string): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.trim().replace(/^["']|["']$/g, "");
    if (address === "" || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    addresses.push(address);
  }
  return addresses;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/** One cell, quoted when needed. A cell a spreadsheet would read as a formula
 * is prefixed so opening the file cannot run it. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCSV(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function downloadCSV(filename: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
