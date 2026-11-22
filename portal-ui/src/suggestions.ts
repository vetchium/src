// As PostgreSQL's lower(), which the searches use: one character at a time.
// Lowering the whole string would turn "İ" into two characters and a final
// "Σ" into "ς", hiding what the API matched.
const lower = (text: string) =>
  Array.from(text, (character) => [...character.toLowerCase()][0]).join("");

/**
 * The suggestions that hold the text typed, exact matches first, then prefix
 * matches, each otherwise in the order given. Enter picks the first option,
 * and the previous answer is still shown until a search answers, so every
 * autocomplete that searches an API passes its options through this.
 * `texts` gives what the API's search matches in one suggestion.
 */
export function matchingSuggestions<Item>(
  items: readonly Item[],
  typed: string,
  texts: (item: Item) => readonly string[],
): Item[] {
  const needle = lower(typed.trim());
  if (needle === "") return [...items];
  const exact: Item[] = [];
  const prefixed: Item[] = [];
  const containing: Item[] = [];
  for (const item of items) {
    const held = texts(item).map(lower);
    if (held.includes(needle)) exact.push(item);
    else if (held.some((text) => text.startsWith(needle))) prefixed.push(item);
    else if (held.some((text) => text.includes(needle))) containing.push(item);
  }
  return [...exact, ...prefixed, ...containing];
}
