import { createElement, type ReactNode } from "react";
import type { Options } from "react-markdown";
import { isWebsiteURL, normalizeWebsiteURL } from "typespec/hub/profile/public";

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
  value?: string;
}

const supportedNodes = new Set([
  "root",
  "paragraph",
  "break",
  "heading",
  "emphasis",
  "strong",
  "list",
  "listItem",
  "link",
  "linkReference",
  "definition",
  "text",
]);

export const openingAllowedElements = [
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
] as const;

export function safeOpeningLinkURL(value: string): string | undefined {
  const normalized = normalizeWebsiteURL(value);
  return isWebsiteURL(normalized) ? normalized : undefined;
}

function literalizeUnsupported(node: MarkdownNode, source: string): void {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (supportedNodes.has(child.type)) {
      literalizeUnsupported(child, source);
      return child;
    }
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    return {
      type: "text",
      value:
        start !== undefined && end !== undefined
          ? source.slice(start, end)
          : (child.value ?? ""),
    };
  });
}

export function openingMarkdownOptions(source: string): Options {
  return {
    allowedElements: openingAllowedElements,
    skipHtml: true,
    unwrapDisallowed: true,
    remarkPlugins: [
      () => (tree: unknown) => {
        // Replace unsupported syntax before HTML conversion so its source stays visible.
        literalizeUnsupported(tree as MarkdownNode, source);
      },
    ],
    urlTransform: (url) => safeOpeningLinkURL(url) ?? "",
    components: {
      a: ({ children, href }): ReactNode => {
        const safeURL = href ? safeOpeningLinkURL(href) : undefined;
        if (!safeURL) return children;
        return createElement(
          "a",
          {
            href: safeURL,
            rel: "noopener noreferrer nofollow ugc",
            referrerPolicy: "no-referrer",
          },
          children,
        );
      },
    },
  };
}
