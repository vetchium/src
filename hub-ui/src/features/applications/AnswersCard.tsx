import { Card, Flex, Typography } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  AnsweredQuestion,
  ApplicationAnswerValue,
} from "typespec/orgs/applications/answers";

function answerText(
  t: TFunction,
  locale: string,
  value: ApplicationAnswerValue,
): string {
  if (typeof value === "boolean")
    return t(value ? "apply.questions.yes" : "apply.questions.no");
  if (typeof value === "number")
    return new Intl.NumberFormat(locale).format(value);
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/** The questions as asked when applying, with the applicant's answers
 * (HP-QST-008); read-only, since answers never change after applying. */
export function AnswersCard({ answers }: { answers: AnsweredQuestion[] }) {
  const { t, i18n } = useTranslation();
  if (answers.length === 0) return null;
  return (
    <Card title={t("applications.detail.answers.title")}>
      <Flex vertical gap="middle">
        <Typography.Text type="secondary">
          {t("applications.detail.answers.help")}
        </Typography.Text>
        {answers.map((answered, index) => (
          <section key={answered.id ?? index} aria-label={answered.text}>
            <Typography.Text strong>{answered.text}</Typography.Text>
            {answered.answer === undefined ? (
              <Typography.Text type="secondary" style={{ display: "block" }}>
                {t("applications.detail.answers.notAnswered")}
              </Typography.Text>
            ) : (
              <Typography.Paragraph
                style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
              >
                {answerText(t, i18n.language, answered.answer)}
              </Typography.Paragraph>
            )}
          </section>
        ))}
      </Flex>
    </Card>
  );
}
