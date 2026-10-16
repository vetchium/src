import Markdown from "react-markdown";
import { openingMarkdownOptions } from "./markdown.ts";

export function OpeningDescription({ source }: { source: string }) {
  return <Markdown {...openingMarkdownOptions(source)}>{source}</Markdown>;
}
