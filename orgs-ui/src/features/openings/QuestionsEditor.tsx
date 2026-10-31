import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Col,
  Collapse,
  Flex,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Switch,
  Typography,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ApplicationQuestion,
  type ApplicationQuestionType,
  applicationQuestionTypes,
  isChoiceQuestion,
  maxApplicationQuestions,
  maxQuestionNumber,
  maxQuestionOption,
  maxQuestionOptions,
  maxQuestionText,
  QuestionNumber,
  QuestionShortText,
} from "typespec/common/openings";
import { OrderControls } from "../../components/common/OrderControls";
import { describeQuestion } from "./presentation";
import { questionsDiffer } from "./publication";

const minQuestionOptions = 2;

/**
 * Edits `content.questions` inside the Opening editor's form. `live` is the
 * live content's questions, when the Opening has been published; changing
 * them then warns that received applications keep their answers (HP-QST-009).
 */
export function QuestionsEditor({
  live,
  applications,
  opened,
}: {
  live?: ApplicationQuestion[];
  /** Applications received so far; absent when the caller cannot read them. */
  applications?: number;
  /** Each change opens every question, so errors inside them show. */
  opened: number;
}) {
  const { t, i18n } = useTranslation();
  const form = Form.useFormInstance();
  const questions = (Form.useWatch(["content", "questions"], form) ??
    []) as Partial<ApplicationQuestion>[];
  const changed = live !== undefined && questionsDiffer(live, questions);
  // Questions start closed to one summary line each; added ones open.
  const [open, setOpen] = useState<string[]>([]);
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  // Set by "Add question" until the new question's key is reported.
  const adding = useRef(false);
  const knownKeys = useRef<string[]>([]);
  const reportKeys = useCallback((keys: string[]) => {
    if (adding.current) {
      adding.current = false;
      const added = keys.filter((key) => !knownKeys.current.includes(key));
      setOpen((current) => [...current, ...added]);
    }
    knownKeys.current = keys;
    setFieldKeys(keys);
  }, []);
  useEffect(() => {
    if (opened > 0) setOpen(fieldKeys);
  }, [opened, fieldKeys]);

  return (
    <Flex vertical gap="middle">
      <Typography.Text type="secondary">
        {t("openings.questions.help")}
      </Typography.Text>
      {changed && (
        <Alert
          type="warning"
          showIcon
          title={t("openings.questions.changedTitle")}
          description={
            applications !== undefined && applications > 0
              ? t("openings.questions.changedReceived", {
                  count: applications,
                })
              : t("openings.questions.changed")
          }
        />
      )}
      <Form.List name={["content", "questions"]}>
        {(fields, { add, remove, move }, { errors }) => (
          <>
            <FieldKeys
              keys={fields.map((field) => String(field.key))}
              onChange={reportKeys}
            />
            <Collapse
              size="small"
              activeKey={open}
              onChange={setOpen}
              items={fields.map((field, index) => {
                const path = ["content", "questions", field.name];
                const question = questions[index];
                const type = question?.type;
                const number = index + 1;
                return {
                  key: String(field.key),
                  forceRender: true,
                  // The order buttons in `extra` must not toggle the panel.
                  collapsible: "header",
                  label: (
                    <Flex vertical>
                      <Typography.Text>
                        {t("openings.questions.summaryLine", {
                          number,
                          text:
                            question?.text?.trim() ||
                            t("openings.questions.untitled"),
                        })}
                      </Typography.Text>
                      {type !== undefined && (
                        <Typography.Text type="secondary">
                          {describeQuestion(t, i18n.language, {
                            text: question?.text ?? "",
                            type,
                            required: question?.required ?? false,
                            ...(question?.min != null && { min: question.min }),
                            ...(question?.max != null && { max: question.max }),
                            ...(question?.options && {
                              options: question.options.filter(Boolean),
                            }),
                          })}
                        </Typography.Text>
                      )}
                    </Flex>
                  ),
                  extra: (
                    <OrderControls
                      size="small"
                      labels={{
                        up: t("openings.questions.moveUp", { number }),
                        down: t("openings.questions.moveDown", { number }),
                        remove: t("openings.questions.remove", { number }),
                      }}
                      first={index === 0}
                      last={index === fields.length - 1}
                      onMove={(direction) => move(index, index + direction)}
                      onRemove={() => remove(field.name)}
                    />
                  ),
                  children: (
                    <>
                      <Form.Item name={[field.name, "id"]} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "text"]}
                        label={t("openings.questions.text")}
                        rules={[
                          {
                            required: true,
                            whitespace: true,
                            message: t("openings.questions.textRequired"),
                          },
                        ]}
                      >
                        <Input.TextArea
                          autoSize={{ minRows: 1, maxRows: 4 }}
                          maxLength={maxQuestionText}
                          showCount
                        />
                      </Form.Item>
                      <Row gutter={16}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name={[field.name, "type"]}
                            label={t("openings.questions.type")}
                          >
                            <Select
                              options={applicationQuestionTypes.map(
                                (value) => ({
                                  value,
                                  label: t(`openings.questions.types.${value}`),
                                }),
                              )}
                              onChange={(next: ApplicationQuestionType) => {
                                const options = form.getFieldValue([
                                  ...path,
                                  "options",
                                ]) as string[] | undefined;
                                if (isChoiceQuestion(next) && !options?.length)
                                  form.setFieldValue(
                                    [...path, "options"],
                                    Array(minQuestionOptions).fill(""),
                                  );
                              }}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name={[field.name, "required"]}
                            label={t("openings.questions.required")}
                            valuePropName="checked"
                          >
                            <Switch />
                          </Form.Item>
                        </Col>
                      </Row>
                      {type === QuestionNumber && (
                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item
                              name={[field.name, "min"]}
                              label={t("openings.questions.min")}
                              extra={t("openings.editor.optional")}
                            >
                              <InputNumber
                                min={0}
                                max={maxQuestionNumber}
                                precision={0}
                                className="full-width"
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item
                              name={[field.name, "max"]}
                              label={t("openings.questions.max")}
                              extra={t("openings.editor.optional")}
                              dependencies={[[...path, "min"]]}
                              rules={[
                                ({ getFieldValue }) => ({
                                  validator: (_, value?: number | null) => {
                                    const min = getFieldValue([
                                      ...path,
                                      "min",
                                    ]) as number | null | undefined;
                                    return value == null ||
                                      min == null ||
                                      value >= min
                                      ? Promise.resolve()
                                      : Promise.reject(
                                          new Error(
                                            t("openings.questions.maxBelowMin"),
                                          ),
                                        );
                                  },
                                }),
                              ]}
                            >
                              <InputNumber
                                min={0}
                                max={maxQuestionNumber}
                                precision={0}
                                className="full-width"
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      )}
                      {type !== undefined && isChoiceQuestion(type) && (
                        <OptionsEditor name={field.name} path={path} />
                      )}
                    </>
                  ),
                };
              })}
            />
            <Form.ErrorList errors={errors} />
            <Flex gap="middle" align="center" wrap justify="space-between">
              <Button
                icon={<PlusOutlined />}
                disabled={fields.length >= maxApplicationQuestions}
                onClick={() => {
                  add({ text: "", type: QuestionShortText, required: false });
                  adding.current = true;
                }}
              >
                {t("openings.questions.add")}
              </Button>
              <Typography.Text type="secondary">
                {fields.length >= maxApplicationQuestions
                  ? t("openings.questions.limitReached", {
                      limit: maxApplicationQuestions,
                    })
                  : t("openings.questions.count", {
                      count: fields.length,
                      limit: maxApplicationQuestions,
                    })}
              </Typography.Text>
            </Flex>
          </>
        )}
      </Form.List>
    </Flex>
  );
}

function OptionsEditor({
  name,
  path,
}: {
  name: number;
  path: (string | number)[];
}) {
  const { t } = useTranslation();
  return (
    <Form.List name={[name, "options"]}>
      {(options, { add, remove }) => (
        <Flex vertical gap="small">
          <Typography.Text strong>
            {t("openings.questions.options")}
          </Typography.Text>
          {options.map((option, index) => (
            <Flex key={option.key} gap="small" align="start">
              <Form.Item
                name={option.name}
                className="full-width"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: t("openings.questions.optionRequired"),
                  },
                  ({ getFieldValue }) => ({
                    validator: (_, value?: string) => {
                      const key = value?.trim().toLowerCase();
                      const all = (getFieldValue([...path, "options"]) ??
                        []) as string[];
                      const repeated =
                        key &&
                        all.filter(
                          (other) => other?.trim().toLowerCase() === key,
                        ).length > 1;
                      return repeated
                        ? Promise.reject(
                            new Error(t("openings.questions.optionRepeated")),
                          )
                        : Promise.resolve();
                    },
                  }),
                ]}
              >
                <Input
                  maxLength={maxQuestionOption}
                  aria-label={t("openings.questions.option", {
                    number: index + 1,
                  })}
                  placeholder={t("openings.questions.option", {
                    number: index + 1,
                  })}
                />
              </Form.Item>
              {options.length > minQuestionOptions && (
                <Button
                  icon={<DeleteOutlined />}
                  aria-label={t("openings.questions.removeOption", {
                    number: index + 1,
                  })}
                  onClick={() => remove(option.name)}
                />
              )}
            </Flex>
          ))}
          <Flex gap="middle" align="center" wrap>
            <Button
              icon={<PlusOutlined />}
              disabled={options.length >= maxQuestionOptions}
              onClick={() => add("")}
            >
              {t("openings.questions.addOption")}
            </Button>
            <Typography.Text type="secondary">
              {t(
                options.length >= maxQuestionOptions
                  ? "openings.questions.optionLimit"
                  : "openings.questions.optionsHelp",
                { min: minQuestionOptions, limit: maxQuestionOptions },
              )}
            </Typography.Text>
          </Flex>
        </Flex>
      )}
    </Form.List>
  );
}

/** Reports the Form.List keys, which exist only inside its render. */
function FieldKeys({
  keys,
  onChange,
}: {
  keys: string[];
  onChange: (keys: string[]) => void;
}) {
  const joined = keys.join(",");
  useEffect(() => {
    onChange(joined === "" ? [] : joined.split(","));
  }, [joined, onChange]);
  return null;
}
