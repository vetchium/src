import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Button, Flex, Input, Select, Typography } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { maxPipelineStages } from "typespec/orgs/hiring/pipelines";
import { stageKindValues } from "typespec/orgs/hiring/vocabulary";
import {
  keptRows,
  moveRow,
  newRow,
  removeRow,
  type StageRow,
  updateRow,
} from "./stageRows";

interface Props {
  rows: readonly StageRow[];
  onChange: (rows: StageRow[]) => void;
  disabled?: boolean;
  /** Notes shown under a stage, such as how many candidates it holds. */
  notes?: (row: StageRow) => ReactNode;
}

/**
 * An ordered, editable list of stages shared by the template editor and an
 * Opening's Pipeline tab. A stage the server already holds keeps its kind;
 * only a new stage chooses one.
 */
export function StageListEditor({ rows, onChange, disabled, notes }: Props) {
  const { t } = useTranslation();
  const keptCount = keptRows(rows).length;
  let position = 0;
  return (
    <Flex vertical gap="small" role="list">
      {rows.map((row, index) => {
        if (!row.removed) position += 1;
        const number = position;
        const kept = !row.removed;
        const keptIndex = keptRows(rows).indexOf(row);
        return (
          <Flex key={row.key} vertical gap={4} role="listitem">
            <Flex gap="small" align="center" wrap>
              <Typography.Text
                type="secondary"
                style={{ minWidth: "1.5em" }}
                aria-hidden
              >
                {kept ? number : ""}
              </Typography.Text>
              <Input
                style={{ flex: "1 1 140px", width: "auto" }}
                aria-label={
                  kept
                    ? t("pipeline.stageName", { number })
                    : t("pipeline.stageNameRemoved", { name: row.name })
                }
                value={row.name}
                maxLength={100}
                disabled={disabled || !kept}
                status={
                  kept && row.name.trim() === "" && row.name !== ""
                    ? "error"
                    : undefined
                }
                placeholder={t("pipeline.stageNamePlaceholder")}
                onChange={(event) =>
                  onChange(updateRow(rows, index, { name: event.target.value }))
                }
              />
              <Select
                style={{ flex: "0 1 180px", minWidth: 150 }}
                aria-label={
                  kept
                    ? t("pipeline.stageKind", { number })
                    : t("pipeline.stageKindRemoved", { name: row.name })
                }
                value={row.kind}
                disabled={disabled || !kept || row.id !== undefined}
                options={stageKindValues.map((value) => ({
                  value,
                  label: t(`pipeline.kinds.${value}`),
                }))}
                onChange={(kind) => onChange(updateRow(rows, index, { kind }))}
              />
              {kept ? (
                <Flex gap={4}>
                  <Button
                    icon={<ArrowUpOutlined />}
                    aria-label={t("pipeline.moveUp", { number })}
                    disabled={disabled || keptIndex === 0}
                    onClick={() => onChange(moveRow(rows, index, -1))}
                  />
                  <Button
                    icon={<ArrowDownOutlined />}
                    aria-label={t("pipeline.moveDown", { number })}
                    disabled={disabled || keptIndex === keptCount - 1}
                    onClick={() => onChange(moveRow(rows, index, 1))}
                  />
                  <Button
                    icon={<DeleteOutlined />}
                    aria-label={t("pipeline.remove", { number })}
                    disabled={disabled || keptCount <= 1}
                    onClick={() => onChange(removeRow(rows, index))}
                  />
                </Flex>
              ) : (
                <Button
                  icon={<UndoOutlined />}
                  aria-label={t("pipeline.restoreStage", { name: row.name })}
                  disabled={disabled}
                  onClick={() =>
                    onChange(updateRow(rows, index, { removed: false }))
                  }
                >
                  {t("pipeline.restore")}
                </Button>
              )}
            </Flex>
            {notes?.(row)}
          </Flex>
        );
      })}
      <Flex gap="middle" align="center" wrap justify="space-between">
        <Button
          icon={<PlusOutlined />}
          disabled={disabled || keptCount >= maxPipelineStages}
          onClick={() => onChange([...rows, newRow()])}
        >
          {t("pipeline.addStage")}
        </Button>
        <Typography.Text type="secondary">
          {keptCount >= maxPipelineStages
            ? t("pipeline.limitReached", { limit: maxPipelineStages })
            : keptCount <= 1
              ? t("pipeline.minimumStage")
              : t("pipeline.stageCount", {
                  count: keptCount,
                  limit: maxPipelineStages,
                })}
        </Typography.Text>
      </Flex>
    </Flex>
  );
}
