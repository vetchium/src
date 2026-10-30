import { Flex, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  AnsweredCriterion,
  CriterionAnswerValue,
} from "typespec/orgs/applications/answers";
import type { Interview } from "typespec/orgs/applications/applications";

interface Row {
  id: string;
  /** The criterion as the form asks it now, else as it was last asked. */
  text: string;
  rating: boolean;
}

function valueText(
  t: TFunction,
  locale: string,
  value: CriterionAnswerValue,
): string {
  if (typeof value === "boolean")
    return t(value ? "applications.answers.yes" : "applications.answers.no");
  if (typeof value === "number")
    return new Intl.NumberFormat(locale).format(value);
  return value;
}

/**
 * Feedback per interview with criteria as rows and interviewers as columns
 * (HP-FRM-005). The average counts only ratings answered to the criterion as
 * the form asks it now.
 */
export function FeedbackComparison({ interview }: { interview: Interview }) {
  const { t, i18n } = useTranslation();
  const feedback = interview.feedback.filter(
    (entry) => entry.criteria_answers.length > 0,
  );
  if (feedback.length === 0) return null;

  const rows = new Map<string, Row>();
  for (const criterion of interview.stage.feedback_form ?? [])
    if (criterion.id !== undefined)
      rows.set(criterion.id, {
        id: criterion.id,
        text: criterion.text,
        rating: criterion.type === "rating",
      });
  for (const entry of feedback)
    for (const asked of entry.criteria_answers)
      if (asked.id !== undefined && !rows.has(asked.id))
        rows.set(asked.id, {
          id: asked.id,
          text: asked.text,
          rating: asked.type === "rating",
        });

  const askedOf = (answers: AnsweredCriterion[], id: string) =>
    answers.find((asked) => asked.id === id);
  const average = (row: Row) => {
    const ratings = feedback.flatMap((entry) => {
      const asked = askedOf(entry.criteria_answers, row.id);
      return asked?.current === "same" && typeof asked.answer === "number"
        ? [asked.answer]
        : [];
    });
    if (ratings.length === 0) return undefined;
    return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  };
  const hasRatings = [...rows.values()].some((row) => row.rating);
  const decimal = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 1,
  });

  const columns: ColumnsType<Row> = [
    {
      title: t("applications.feedback.compare.criterion"),
      key: "criterion",
      fixed: "start",
      width: 200,
      render: (_, row) => row.text,
    },
    ...feedback.map((entry) => ({
      title: entry.interviewer_email,
      key: entry.interviewer_email,
      width: 220,
      render: (_: unknown, row: Row) => {
        const asked = askedOf(entry.criteria_answers, row.id);
        if (asked === undefined)
          return (
            <Typography.Text type="secondary">
              {t("applications.feedback.compare.notAsked")}
            </Typography.Text>
          );
        return (
          <Flex vertical gap={2}>
            {asked.answer === undefined ? (
              <Typography.Text type="secondary">
                {t("applications.answers.notAnswered")}
              </Typography.Text>
            ) : (
              <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                {valueText(t, i18n.language, asked.answer)}
              </Typography.Text>
            )}
            {asked.current !== "same" && (
              <>
                <Tag
                  color={asked.current === "changed" ? "warning" : undefined}
                  style={{ alignSelf: "flex-start" }}
                >
                  {t(
                    asked.current === "changed"
                      ? "applications.feedback.compare.changed"
                      : "applications.feedback.compare.removed",
                  )}
                </Tag>
                <Typography.Text type="secondary">
                  {t("applications.feedback.compare.asked", {
                    text: asked.text,
                  })}
                </Typography.Text>
              </>
            )}
          </Flex>
        );
      },
    })),
    ...(hasRatings
      ? [
          {
            title: t("applications.feedback.compare.average"),
            key: "average",
            align: "end" as const,
            width: 110,
            render: (_: unknown, row: Row) => {
              const value = row.rating ? average(row) : undefined;
              return value === undefined ? (
                <Typography.Text type="secondary">—</Typography.Text>
              ) : (
                decimal.format(value)
              );
            },
          },
        ]
      : []),
  ];

  return (
    <Table
      size="small"
      rowKey="id"
      aria-label={t("applications.feedback.compare.title", {
        number: interview.interview_number,
      })}
      title={() => t("applications.feedback.compare.heading")}
      columns={columns}
      dataSource={[...rows.values()]}
      pagination={false}
      scroll={{ x: "max-content" }}
    />
  );
}
