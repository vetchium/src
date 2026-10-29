import { Card, Flex, Tag, Typography } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ApplicationAnswerValue } from "typespec/orgs/applications/answers";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";

/** An answer as text, by the kind of value its question takes. */
export function answerText(
  t: TFunction,
  locale: string,
  value: ApplicationAnswerValue,
): string {
  if (typeof value === "boolean")
    return t(value ? "applications.answers.yes" : "applications.answers.no");
  if (typeof value === "number")
    return new Intl.NumberFormat(locale).format(value);
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/** The applicant's answers as given when applying (HP-QST-006, HP-QST-009). */
export function AnswersCard({ detail }: { detail: ApplicationDetail }) {
  const { t, i18n } = useTranslation();
  if (detail.removed || detail.answers.length === 0) return null;
  return (
    <Card title={t("applications.answers.title")}>
      <Flex vertical gap="middle">
        {detail.answers.map((answered, index) => (
          <section key={answered.id ?? index} aria-label={answered.text}>
            <Flex gap="small" align="baseline" wrap>
              <Typography.Text strong>{answered.text}</Typography.Text>
              {answered.current === "changed" && (
                <Tag color="warning">{t("applications.answers.changed")}</Tag>
              )}
              {answered.current === "removed" && (
                <Tag>{t("applications.answers.removed")}</Tag>
              )}
            </Flex>
            {answered.current !== "same" && (
              <Typography.Text type="secondary" style={{ display: "block" }}>
                {t("applications.answers.asAsked")}
              </Typography.Text>
            )}
            {answered.answer === undefined ? (
              <Typography.Text type="secondary" style={{ display: "block" }}>
                {t("applications.answers.notAnswered")}
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
