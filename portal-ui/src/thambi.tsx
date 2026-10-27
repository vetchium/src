import Icon from "@ant-design/icons";
import { theme } from "antd";
import type { ComponentProps } from "react";

// Thambi is Vetchium's AI assistant: a bee striped in the colours of the
// flowers that make up the Vetchium logo. Outlines use currentColor so the bee
// keeps its contrast on light, dark, and primary-button backgrounds.

const pink = "#E8458B";
const rose = "#F28AC0";
const red = "#D7262E";
const orange = "#EE6A2C";
const yellow = "#F5B91E";
const cream = "#F8E7C4";

const stripes = [
  ["M3.2 13.78A8 5.5 0 0 1 5.4 11.07V18.93A8 5.5 0 0 1 3.2 16.22Z", orange],
  ["M7.4 10.09A8 5.5 0 0 1 9.6 9.58V20.42A8 5.5 0 0 1 7.4 19.91Z", pink],
  ["M11.6 9.52A8 5.5 0 0 1 13.8 9.85V20.15A8 5.5 0 0 1 11.6 20.48Z", red],
] as const;

/** Faces right in a 24-unit square; the body centre is (11, 15). */
function Bee() {
  return (
    <g transform="rotate(-10 12 14)">
      <ellipse
        cx="8.2"
        cy="7.6"
        rx="2.6"
        ry="4.4"
        transform="rotate(-30 8.2 7.6)"
        fill="#fff"
        fillOpacity="0.85"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <ellipse
        cx="12.4"
        cy="7.2"
        rx="2.6"
        ry="4.4"
        transform="rotate(16 12.4 7.2)"
        fill="#fff"
        fillOpacity="0.85"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M3.5 14 .6 15 3.5 16Z" fill="currentColor" />
      <ellipse cx="11" cy="15" rx="8" ry="5.5" fill={yellow} />
      {stripes.map(([d, color]) => (
        <path key={d} d={d} fill={color} />
      ))}
      <ellipse
        cx="11"
        cy="15"
        rx="8"
        ry="5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="19.4" cy="13.4" r="3" fill="currentColor" />
      <path
        d="M20.6 10.8Q21 8 23.2 7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </g>
  );
}

const petal = "M12 12C10.5 10.2 10.7 7.5 12 5.6 13.3 7.5 13.5 10.2 12 12Z";

/** A five-petalled vetchi flower centred on (x, y). */
function Flower({
  x,
  y,
  scale,
  colors,
}: {
  x: number;
  y: number;
  scale: number;
  colors: readonly [string, string, string, string, string];
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) translate(-12 -12)`}>
      {colors.map((color, index) => {
        const angle = index * 72;
        return (
          <path
            key={angle}
            d={petal}
            fill={color}
            transform={`rotate(${angle} 12 12)`}
          />
        );
      })}
      <circle cx="12" cy="12" r="1.1" fill={cream} />
    </g>
  );
}

/** Marks a control that asks Thambi, the AI assistant, for help. */
export function ThambiIcon(
  props: Omit<
    ComponentProps<typeof Icon>,
    "children" | "component" | "viewBox"
  >,
) {
  return (
    <Icon viewBox="0 0 24 24" aria-hidden {...props}>
      <Bee />
    </Icon>
  );
}

// The bee's figure-eight flight around the two flowers of the large spinner.
const flightPath =
  "M32 26C38 14 54 14 54 26 54 38 38 38 32 26 26 14 10 14 10 26 10 38 26 38 32 26Z";

/**
 * Shows Thambi at work while an AI operation runs. `small` sizes like an
 * icon (a button's `loading.icon`); `large` stands beside status text. The
 * bee rests while Ant Design motion is off.
 */
export function ThambiSpinner({
  size = "small",
}: {
  size?: "small" | "large";
}) {
  const { token } = theme.useToken();
  const motion = token.motion;
  if (size === "small") {
    return (
      <Icon viewBox="0 0 24 24" aria-hidden>
        <circle
          cx="12"
          cy="12"
          r="7.2"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="1.2"
          strokeDasharray="1.6 2.4"
        />
        <Flower
          x={12}
          y={12}
          scale={0.55}
          colors={[pink, orange, red, yellow, rose]}
        />
        <g>
          {motion ? (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="1s"
              repeatCount="indefinite"
            />
          ) : null}
          <g transform="translate(12 4.8) scale(0.42) translate(-12 -14)">
            <Bee />
          </g>
        </g>
      </Icon>
    );
  }
  return (
    <svg viewBox="0 0 64 44" width="96" height="66" aria-hidden="true">
      <path
        d={flightPath}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="0.8"
        strokeDasharray="1.5 2"
      />
      <Flower
        x={21}
        y={26}
        scale={1.1}
        colors={[pink, rose, pink, rose, pink]}
      />
      <Flower
        x={43}
        y={26}
        scale={1.1}
        colors={[red, orange, yellow, red, orange]}
      />
      {motion ? (
        <g>
          <animateMotion
            path={flightPath}
            rotate="auto"
            dur="2.8s"
            repeatCount="indefinite"
          />
          <g transform="scale(0.5) translate(-12 -14)">
            <Bee />
          </g>
        </g>
      ) : (
        <g transform="translate(43 17) scale(0.5) translate(-12 -14)">
          <Bee />
        </g>
      )}
    </svg>
  );
}
