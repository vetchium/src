import { Form, Input, Radio } from "antd";
import { useTranslation } from "react-i18next";
import {
  type CriterionAnswer,
  type CriterionAnswerValue,
  maxCriterionRating,
  maxCriterionTextValue,
  minCriterionRating,
} from "typespec/orgs/applications/answers";
import type { FeedbackCriterion } from "typespec/orgs/hiring/pipelines";

/** Answers by criterion id; a criterion not yet answered is absent. */
export type CriteriaValues = Readonly<Record<string, CriterionAnswerValue>>;

const ratings = Array.from(
  { length: maxCriterionRating - minCriterionRating + 1 },
  (_, index) => minCriterionRating + index,
);

function answered(value: CriterionAnswerValue | undefined): boolean {
  return (
    value !== undefined && (typeof value !== "string" || value.trim() !== "")
  );
}

/** Whether every required criterion has an answer (HP-FRM-003). */
export function criteriaComplete(
  form: readonly FeedbackCriterion[],
  values: CriteriaValues,
): boolean {
  return form.every(
    (criterion) =>
      !criterion.required ||
      (criterion.id !== undefined && answered(values[criterion.id])),
  );
}

/** The answers to send, in form order; a blank text answer is no answer. */
export function criteriaAnswers(
  form: readonly FeedbackCriterion[],
  values: CriteriaValues,
): CriterionAnswer[] {
  return form.flatMap((criterion) => {
    const value = criterion.id === undefined ? undefined : values[criterion.id];
    if (criterion.id === undefined || value === undefined || !answered(value))
      return [];
    return [
      {
        criterion_id: criterion.id,
        value: typeof value === "string" ? value.trim() : value,
      },
    ];
  });
}

interface Props {
  form: readonly FeedbackCriterion[];
  values: CriteriaValues;
  onChange: (values: CriteriaValues) => void;
  /** Criteria the API refused, marked until they change. */
  invalid?: readonly string[];
  disabled?: boolean;
}

/** An input per criterion of the interview stage's feedback form. */
export function CriteriaInputs({
  form,
  values,
  onChange,
  invalid = [],
  disabled,
}: Props) {
  const { t } = useTranslation();
  return (
    <>
      {form.map((criterion) => {
        const id = criterion.id;
        if (id === undefined) return null;
        const value = values[id];
        const set = (next: CriterionAnswerValue | undefined) => {
          const { [id]: _previous, ...rest } = values;
          onChange(next === undefined ? rest : { ...rest, [id]: next });
        };
        const refused = invalid.includes(id);
        return (
          <Form.Item
            key={id}
            label={criterion.text}
            required={criterion.required}
            {...(refused && {
              validateStatus: "error" as const,
              help: t("applications.feedback.criterionInvalid"),
            })}
          >
            {criterion.type === "rating" ? (
              <Radio.Group
                optionType="button"
                aria-label={criterion.text}
                disabled={disabled}
                value={value}
                onChange={(event) => set(event.target.value as number)}
                options={ratings.map((rating) => ({
                  value: rating,
                  label: String(rating),
                }))}
              />
            ) : criterion.type === "yes_no" ? (
              <Radio.Group
                aria-label={criterion.text}
                disabled={disabled}
                value={value}
                onChange={(event) => set(event.target.value as boolean)}
                options={[
                  { value: true, label: t("applications.answers.yes") },
                  { value: false, label: t("applications.answers.no") },
                ]}
              />
            ) : (
              <Input.TextArea
                aria-label={criterion.text}
                disabled={disabled}
                rows={3}
                maxLength={maxCriterionTextValue}
                showCount
                value={typeof value === "string" ? value : ""}
                onChange={(event) =>
                  set(
                    event.target.value === "" ? undefined : event.target.value,
                  )
                }
              />
            )}
          </Form.Item>
        );
      })}
    </>
  );
}
