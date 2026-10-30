import { Checkbox, Flex, Form, Input, InputNumber, Radio } from "antd";
import type { Rule } from "antd/es/form";
import { useTranslation } from "react-i18next";
import {
  type ApplicationQuestion,
  QuestionLongText,
  QuestionMultipleChoice,
  QuestionNumber,
  QuestionShortText,
  QuestionSingleChoice,
  QuestionYesNo,
} from "typespec/common/openings";
import {
  type ApplicationAnswer,
  type ApplicationAnswerValue,
  maxLongTextAnswer,
  maxShortTextAnswer,
} from "typespec/orgs/applications/answers";

/** Form values by question id; absent or blank means unanswered. */
export type AnswerValues = Partial<
  Record<string, ApplicationAnswerValue | null>
>;

function blank(value: ApplicationAnswerValue | null | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Whether a kept value still suits the question, after the Org edited it. */
export function answerFits(
  question: ApplicationQuestion,
  value: ApplicationAnswerValue | null | undefined,
): boolean {
  if (blank(value)) return true;
  switch (question.type) {
    case QuestionShortText:
    case QuestionLongText:
      return typeof value === "string";
    case QuestionNumber:
      return typeof value === "number";
    case QuestionYesNo:
      return typeof value === "boolean";
    case QuestionSingleChoice:
      return typeof value === "string" && !!question.options?.includes(value);
    case QuestionMultipleChoice:
      return (
        Array.isArray(value) &&
        value.every((option) => question.options?.includes(option))
      );
    default:
      return false;
  }
}

// The required rule checks the value's type, which defaults to string.
const ruleTypes: Readonly<
  Record<string, "string" | "number" | "boolean" | "array">
> = {
  [QuestionShortText]: "string",
  [QuestionLongText]: "string",
  [QuestionNumber]: "number",
  [QuestionYesNo]: "boolean",
  [QuestionSingleChoice]: "string",
  [QuestionMultipleChoice]: "array",
};

/** The answers to send, in question order; blank optional answers are left
 * out (HP-QST-004). */
export function answersFor(
  questions: readonly ApplicationQuestion[],
  values: AnswerValues,
): ApplicationAnswer[] {
  return questions.flatMap((question) => {
    const value = question.id === undefined ? undefined : values[question.id];
    if (question.id === undefined || value === undefined || value === null)
      return [];
    if (blank(value)) return [];
    return [
      {
        question_id: question.id,
        value: typeof value === "string" ? value.trim() : value,
      },
    ];
  });
}

interface Props {
  questions: readonly ApplicationQuestion[];
  /** Questions the Org's tenant refused, marked until answered again. */
  invalid: readonly string[];
  orgName: string;
}

/** One input per live question, inside the apply form's `answers` field. */
export function QuestionInputs({ questions, invalid, orgName }: Props) {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language).format;
  return (
    <Flex vertical>
      {questions.map((question) => {
        const id = question.id;
        if (id === undefined) return null;
        const rules: Rule[] = question.required
          ? [
              {
                required: true,
                type: ruleTypes[question.type] ?? "string",
                whitespace: question.type !== QuestionMultipleChoice,
                message: t("apply.questions.required"),
              },
            ]
          : [];
        const { min, max } = question;
        const bounds =
          min !== undefined && max !== undefined
            ? t("apply.questions.range", { min: format(min), max: format(max) })
            : min !== undefined
              ? t("apply.questions.atLeast", { min: format(min) })
              : max !== undefined
                ? t("apply.questions.atMost", { max: format(max) })
                : undefined;
        if (question.type === QuestionNumber)
          rules.push({
            validator: async (_, value: number | null | undefined) => {
              if (value === undefined || value === null) return;
              if (
                !Number.isSafeInteger(value) ||
                (min !== undefined && value < min) ||
                (max !== undefined && value > max)
              )
                throw new Error(
                  bounds === undefined
                    ? t("apply.questions.wholeNumber")
                    : t("apply.questions.outOfRange", { bounds }),
                );
            },
          });
        const refused = invalid.includes(id);
        return (
          <Form.Item
            key={id}
            name={["answers", id]}
            label={question.text}
            required={question.required}
            rules={rules}
            {...(question.type === QuestionNumber &&
              bounds !== undefined && { extra: bounds })}
            {...(question.type === QuestionMultipleChoice && {
              extra: t("apply.questions.chooseAny"),
            })}
            {...(refused && {
              validateStatus: "error" as const,
              help: t("apply.questions.changed", { org: orgName }),
            })}
          >
            {question.type === QuestionShortText ? (
              <Input maxLength={maxShortTextAnswer} showCount />
            ) : question.type === QuestionLongText ? (
              <Input.TextArea
                rows={4}
                maxLength={maxLongTextAnswer}
                showCount
              />
            ) : question.type === QuestionNumber ? (
              <InputNumber
                {...(min !== undefined && { min })}
                {...(max !== undefined && { max })}
                precision={0}
                step={1}
                className="full-width"
              />
            ) : question.type === QuestionYesNo ? (
              <Radio.Group
                aria-label={question.text}
                options={[
                  { value: true, label: t("apply.questions.yes") },
                  { value: false, label: t("apply.questions.no") },
                ]}
              />
            ) : question.type === QuestionSingleChoice ? (
              <Radio.Group aria-label={question.text}>
                <Flex vertical gap="small">
                  {(question.options ?? []).map((option) => (
                    <Radio key={option} value={option}>
                      {option}
                    </Radio>
                  ))}
                </Flex>
              </Radio.Group>
            ) : question.type === QuestionMultipleChoice ? (
              <Checkbox.Group role="group" aria-label={question.text}>
                <Flex vertical gap="small">
                  {(question.options ?? []).map((option) => (
                    <Checkbox key={option} value={option}>
                      {option}
                    </Checkbox>
                  ))}
                </Flex>
              </Checkbox.Group>
            ) : null}
          </Form.Item>
        );
      })}
    </Flex>
  );
}
