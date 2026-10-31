import {
  DownOutlined,
  PlusOutlined,
  RightOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Button, Flex, Input, Select, Typography } from "antd";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { maxPipelineStages } from "typespec/orgs/hiring/pipelines";
import { stageKindValues } from "typespec/orgs/hiring/vocabulary";
import { OrderControls } from "../../components/common/OrderControls";
import { FeedbackFormEditor } from "./FeedbackFormEditor";
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
 * only a new stage chooses one. An interview stage's feedback form is
 * optional, so it starts closed unless the stage already has one.
 */
export function StageListEditor({ rows, onChange, disabled, notes }: Props) {
  const { t } = useTranslation();
  const [openForms, setOpenForms] = useState(
    () => new Set(rows.filter((row) => row.form.length > 0).map((r) => r.key)),
  );
  const toggleForm = (key: string) =>
    setOpenForms((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
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
                <OrderControls
                  labels={{
                    up: t("pipeline.moveUp", { number }),
                    down: t("pipeline.moveDown", { number }),
                    remove: t("pipeline.remove", { number }),
                  }}
                  first={keptIndex === 0}
                  last={keptIndex === keptCount - 1}
                  disabled={disabled}
                  removeDisabled={keptCount <= 1}
                  onMove={(direction) =>
                    onChange(moveRow(rows, index, direction))
                  }
                  onRemove={() => onChange(removeRow(rows, index))}
                />
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
            {kept && row.kind === "interview" && (
              <Flex vertical gap="small" style={{ paddingInlineStart: "2em" }}>
                <Button
                  type="link"
                  size="small"
                  style={{ alignSelf: "flex-start", paddingInline: 0 }}
                  icon={
                    openForms.has(row.key) ? (
                      <DownOutlined />
                    ) : (
                      <RightOutlined />
                    )
                  }
                  aria-expanded={openForms.has(row.key)}
                  onClick={() => toggleForm(row.key)}
                >
                  {t("pipeline.form.toggle", {
                    stage: row.name.trim() || t("pipeline.form.unnamed"),
                    count: row.form.length,
                  })}
                </Button>
                {openForms.has(row.key) && (
                  <FeedbackFormEditor
                    stage={row.name.trim() || t("pipeline.form.unnamed")}
                    form={row.form}
                    disabled={disabled}
                    onChange={(form) =>
                      onChange(updateRow(rows, index, { form }))
                    }
                  />
                )}
              </Flex>
            )}
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
