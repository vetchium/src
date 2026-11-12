import { Flex, Tag } from "antd";
import { OpeningTagIcon } from "./icons.tsx";

export interface OpeningTagListProps {
  tags: readonly string[];
  /** The tag's name in the portal language. */
  name: (oid: string) => string;
  /** The list's accessible name, such as "Tags". */
  label: string;
}

/** Tags in the Opening's order, each as its icon and name. */
export function OpeningTagList({ tags, name, label }: OpeningTagListProps) {
  if (tags.length === 0) return null;
  return (
    <Flex
      component="ul"
      gap="small"
      wrap
      aria-label={label}
      style={{ listStyle: "none", margin: 0, padding: 0 }}
    >
      {tags.map((oid) => (
        <li key={oid}>
          <Tag icon={<OpeningTagIcon oid={oid} />}>{name(oid)}</Tag>
        </li>
      ))}
    </Flex>
  );
}
