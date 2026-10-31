import {
  Checkbox,
  ConfigProvider,
  Form,
  Input,
  InputNumber,
  Radio,
  Typography,
  theme,
} from "antd";
import type { Rule } from "antd/es/form";
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
  maxLongTextAnswer,
  maxShortTextAnswer,
} from "typespec/orgs/applications/answers";

export interface QuestionFieldsLabels {
  required: string;
  yes: string;
  no: string;
  chooseAny: string;
  wholeNumber: string;
  /** The question changed after the page loaded and needs a new answer. */
  changed: string;
  bounds: (min?: number, max?: number) => string | undefined;
  outOfRange: (bounds: string) => string;
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

interface Props {
  questions: readonly ApplicationQuestion[];
  labels: QuestionFieldsLabels;
  /** Questions to mark with `labels.changed` until answered again. */
  invalid?: readonly string[];
}

/**
 * One input per question inside a parent `Form`, under its `answers` field.
 * The Hub apply page and the Orgs preview of the application form both render
 * it, so Orgs see exactly what applicants fill in.
 */
export function QuestionFields({ questions, labels, invalid = [] }: Props) {
  const { token } = theme.useToken();
  return (
    <ConfigProvider
      theme={{
        components: {
          Form: {
            itemMarginBottom: token.marginMD,
            verticalLabelPadding: `0 0 ${token.paddingXXS}px`,
          },
        },
      }}
    >
      {questions.map((question, index) => {
        const id = question.id ?? `new-${index}`;
        const rules: Rule[] = question.required
          ? [
              {
                required: true,
                type: ruleTypes[question.type] ?? "string",
                whitespace: question.type !== QuestionMultipleChoice,
                message: labels.required,
              },
            ]
          : [];
        const { min, max } = question;
        const bounds = labels.bounds(min, max);
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
                    ? labels.wholeNumber
                    : labels.outOfRange(bounds),
                );
            },
          });
        const refused = invalid.includes(id);
        return (
          <Form.Item
            key={id}
            name={["answers", id]}
            label={
              <span>
                <Typography.Text type="secondary">
                  {index + 1}.{" "}
                </Typography.Text>
                {question.text}
              </span>
            }
            required={question.required}
            rules={rules}
            {...(question.type === QuestionNumber &&
              bounds !== undefined && { extra: bounds })}
            {...(question.type === QuestionMultipleChoice && {
              extra: labels.chooseAny,
            })}
            {...(refused && {
              validateStatus: "error" as const,
              help: labels.changed,
            })}
          >
            {question.type === QuestionShortText ? (
              <Input maxLength={maxShortTextAnswer} showCount />
            ) : question.type === QuestionLongText ? (
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 10 }}
                maxLength={maxLongTextAnswer}
                showCount
              />
            ) : question.type === QuestionNumber ? (
              <InputNumber
                {...(min !== undefined && { min })}
                {...(max !== undefined && { max })}
                precision={0}
                step={1}
              />
            ) : question.type === QuestionYesNo ? (
              <Radio.Group
                aria-label={question.text}
                optionType="button"
                options={[
                  { value: true, label: labels.yes },
                  { value: false, label: labels.no },
                ]}
              />
            ) : question.type === QuestionSingleChoice ? (
              <Radio.Group
                aria-label={question.text}
                options={question.options ?? []}
              />
            ) : question.type === QuestionMultipleChoice ? (
              <Checkbox.Group
                role="group"
                aria-label={question.text}
                options={question.options ?? []}
              />
            ) : null}
          </Form.Item>
        );
      })}
    </ConfigProvider>
  );
}
