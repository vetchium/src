import { PlusOutlined } from "@ant-design/icons";
import { Button, Checkbox, Flex, Input, Select, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  CriterionRating,
  CriterionText,
  CriterionYesNo,
  type FeedbackCriterion,
  type FeedbackCriterionType,
  maxFeedbackCriteria,
} from "typespec/orgs/hiring/pipelines";
import { OrderControls } from "../../components/common/OrderControls";

const criterionTypes = [CriterionRating, CriterionYesNo, CriterionText];
const maxCriterionText = 500;

interface Props {
  stage: string;
  form: readonly FeedbackCriterion[];
  onChange: (form: FeedbackCriterion[]) => void;
  disabled?: boolean;
}

/** The criteria interviewers answer for an interview stage (HP-FRM-001). */
export function FeedbackFormEditor({ stage, form, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const update = (index: number, change: Partial<FeedbackCriterion>) =>
    onChange(
      form.map((criterion, position) =>
        position === index ? { ...criterion, ...change } : criterion,
      ),
    );
  const move = (index: number, direction: -1 | 1) => {
    const next = [...form];
    const target = index + direction;
    const moved = next[index];
    const other = next[target];
    if (moved === undefined || other === undefined) return;
    next[index] = other;
    next[target] = moved;
    onChange(next);
  };
  return (
    <Flex
      vertical
      gap="small"
      role="group"
      aria-label={t("pipeline.form.label", { stage })}
    >
      <Typography.Text type="secondary">
        {t("pipeline.form.help")}
      </Typography.Text>
      {form.map((criterion, index) => {
        const number = index + 1;
        const blank = criterion.text.trim() === "";
        return (
          <Flex
            key={criterion.id ?? `new-${index}`}
            gap="small"
            align="center"
            wrap
          >
            <Typography.Text
              type="secondary"
              style={{ minWidth: "1.5em" }}
              aria-hidden
            >
              {number}
            </Typography.Text>
            <Input
              style={{ flex: "1 1 200px", width: "auto" }}
              aria-label={t("pipeline.form.criterion", { number, stage })}
              placeholder={t("pipeline.form.criterionPlaceholder")}
              value={criterion.text}
              maxLength={maxCriterionText}
              disabled={disabled}
              status={blank ? "error" : undefined}
              onChange={(event) => update(index, { text: event.target.value })}
            />
            <Select
              style={{ flex: "0 1 150px", minWidth: 130 }}
              aria-label={t("pipeline.form.type", { number, stage })}
              value={criterion.type}
              disabled={disabled}
              options={criterionTypes.map((value) => ({
                value,
                label: t(`pipeline.form.types.${value}`),
              }))}
              onChange={(type: FeedbackCriterionType) =>
                update(index, { type })
              }
            />
            <Checkbox
              checked={criterion.required}
              disabled={disabled}
              onChange={(event) =>
                update(index, { required: event.target.checked })
              }
            >
              {t("pipeline.form.required")}
            </Checkbox>
            <OrderControls
              size="small"
              labels={{
                up: t("pipeline.form.moveUp", { number, stage }),
                down: t("pipeline.form.moveDown", { number, stage }),
                remove: t("pipeline.form.remove", { number, stage }),
              }}
              first={index === 0}
              last={index === form.length - 1}
              disabled={disabled}
              onMove={(direction) => move(index, direction)}
              onRemove={() =>
                onChange(form.filter((_, position) => position !== index))
              }
            />
          </Flex>
        );
      })}
      <Flex gap="middle" align="center" wrap>
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={disabled || form.length >= maxFeedbackCriteria}
          onClick={() =>
            onChange([
              ...form,
              { text: "", type: CriterionRating, required: false },
            ])
          }
        >
          {t("pipeline.form.add")}
        </Button>
        <Typography.Text type="secondary">
          {form.length >= maxFeedbackCriteria
            ? t("pipeline.form.limitReached", { limit: maxFeedbackCriteria })
            : t("pipeline.form.count", {
                count: form.length,
                limit: maxFeedbackCriteria,
              })}
        </Typography.Text>
      </Flex>
    </Flex>
  );
}
