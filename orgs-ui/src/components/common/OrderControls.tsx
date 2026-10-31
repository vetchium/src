import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { Button, Flex } from "antd";

interface Props {
  /** Accessible names, each naming the item, such as "Move question 2 up". */
  labels: { up: string; down: string; remove: string };
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  disabled?: boolean;
  /** Set when the list cannot lose another item. */
  removeDisabled?: boolean;
  size?: "small" | "middle";
}

/** Move up, move down, and remove buttons for one item of an ordered list. */
export function OrderControls({
  labels,
  first,
  last,
  onMove,
  onRemove,
  disabled,
  removeDisabled,
  size = "middle",
}: Props) {
  return (
    <Flex gap={4}>
      <Button
        size={size}
        icon={<ArrowUpOutlined />}
        aria-label={labels.up}
        disabled={disabled || first}
        onClick={() => onMove(-1)}
      />
      <Button
        size={size}
        icon={<ArrowDownOutlined />}
        aria-label={labels.down}
        disabled={disabled || last}
        onClick={() => onMove(1)}
      />
      <Button
        size={size}
        icon={<DeleteOutlined />}
        aria-label={labels.remove}
        disabled={disabled || removeDisabled}
        onClick={onRemove}
      />
    </Flex>
  );
}
