/**
 * Asks crawlers not to index the page. React hoists the tag into the
 * document head; the static host and nginx also send `X-Robots-Tag` for the
 * same paths, which covers crawlers that never run this script.
 */
export function NoIndex() {
  return <meta name="robots" content="noindex" />;
}
