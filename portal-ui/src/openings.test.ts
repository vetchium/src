import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import {
  openingAllowedElements,
  openingMarkdownOptions,
} from "./openings/markdown.ts";

function render(source: string): string {
  return renderToStaticMarkup(
    createElement(Markdown, openingMarkdownOptions(source), source),
  );
}

test("Opening description renders only the approved Markdown elements", () => {
  assert.deepEqual(openingAllowedElements, [
    "p",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "em",
    "strong",
    "ol",
    "ul",
    "li",
    "a",
  ]);
  const html = render(
    "# Title\n\n**bold** *italic*\n\n- one\n- two\n\n1. three\n2. four\n\nline  \nnext",
  );
  for (const tag of ["h1", "strong", "em", "ul", "ol", "li", "br"]) {
    assert.match(html, new RegExp(`<${tag}[ />]`));
  }
});

test("raw HTML and images remain literal text", () => {
  const html = render(
    "Before <script>alert(1)</script> ![secret](https://example.com/a.png) after",
  );
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /!\[secret\]\(https:\/\/example.com\/a.png\)/);
  assert.doesNotMatch(html, /<script|<img/);
});

test("only valid website links render as links", () => {
  const html = render(
    "[safe](https://example.com/jobs) [bad](javascript:alert%281%29) [http](http://example.com) [ip](https://127.0.0.1/path)",
  );
  assert.match(html, /href="https:\/\/example.com\/jobs"/);
  assert.match(html, /rel="noopener noreferrer nofollow ugc"/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  for (const text of ["bad", "http", "ip"])
    assert.match(html, new RegExp(text));
});

test("unsupported constructs retain their source syntax", () => {
  const html = render("`code`\n\n> quote\n\n---");
  assert.match(html, /`code`/);
  assert.match(html, /&gt; quote/);
  assert.match(html, /---/);
  assert.doesNotMatch(html, /<code|<blockquote|<hr/);
});
