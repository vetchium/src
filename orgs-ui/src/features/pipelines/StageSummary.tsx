import { Flex, Tag } from "antd";
import type { PipelineStageDefinition } from "typespec/orgs/hiring/pipelines";

/** The stages in order as numbered tags. */
export function StageSummary({
  stages,
}: {
  stages: readonly PipelineStageDefinition[];
}) {
  return (
    <Flex gap={4} wrap role="list">
      {stages.map((stage, index) => (
        // A template may repeat a stage name, so the position keys the tag.
        // biome-ignore lint/suspicious/noArrayIndexKey: stages have no id here
        <Tag key={index} variant="filled" role="listitem">
          {index + 1}. {stage.name}
        </Tag>
      ))}
    </Flex>
  );
}
