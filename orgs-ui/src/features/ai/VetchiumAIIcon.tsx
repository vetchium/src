import Icon from "@ant-design/icons";
import type { ComponentProps } from "react";

/** A "V" with the sparkles that mark AI features across the web. */
function Glyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M1 5h3.2l4.3 11.2L12.8 5H16l-6 15H7z" />
      <path d="M19.5 0.5l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z" />
      <path d="M20.5 10l0.6 1.4 1.4 0.6-1.4 0.6-0.6 1.4-0.6-1.4-1.4-0.6 1.4-0.6z" />
    </svg>
  );
}

export function VetchiumAIIcon(
  props: Omit<ComponentProps<typeof Icon>, "component">,
) {
  return <Icon component={Glyph} aria-hidden {...props} />;
}
