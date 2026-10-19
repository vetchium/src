import { Card, Statistic, Typography, theme } from "antd";
import type { KeyboardEvent } from "react";

interface Props {
  title: string;
  caption?: string;
  value: number;
  selected: boolean;
  onSelect: () => void;
}

/** A count that doubles as the filter for the list under it. */
export function FilterCard({
  title,
  caption,
  value,
  selected,
  onSelect,
}: Props) {
  const { token } = theme.useToken();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };
  return (
    <Card
      size="small"
      hoverable
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      style={{
        minWidth: 140,
        flex: "1 1 140px",
        maxWidth: 240,
        borderColor: selected ? token.colorPrimary : undefined,
      }}
    >
      <Statistic title={title} value={value} />
      {caption && <Typography.Text type="secondary">{caption}</Typography.Text>}
    </Card>
  );
}
