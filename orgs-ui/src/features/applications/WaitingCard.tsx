import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Card, Flex, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  ApplicationDetail,
  PendingApplicantAction,
} from "typespec/orgs/applications/applications";

/** What the applicant still has to answer, from what the API already shows. */
export function WaitingCard({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  if (detail.removed) return null;
  const now = Date.now();
  const waiting: Array<{ action: PendingApplicantAction; note: string }> = [];
  for (const interview of detail.interviews) {
    if (
      interview.state === "scheduled" &&
      new Date(interview.starts_at).getTime() > now &&
      interview.applicant_response === "pending"
    ) {
      waiting.push({
        action: "interview_response",
        note: t("applications.waiting.interview", {
          number: interview.interview_number,
          start: dateTime(interview.starts_at),
        }),
      });
    }
  }
  for (const check of detail.background_checks) {
    if (check.consent_state === "requested") {
      waiting.push({
        action: "background_check_consent",
        note: t("applications.waiting.consent", { stage: check.stage.name }),
      });
    }
  }
  const offer = detail.offers.find(
    (entry) =>
      entry.status === "extended" && new Date(entry.respond_by).getTime() > now,
  );
  if (detail.state === "offered" && offer) {
    waiting.push({
      action: "offer_response",
      note: t("applications.waiting.offer", {
        date: dateTime(offer.respond_by),
      }),
    });
  }
  if (waiting.length === 0) return null;
  return (
    <Card title={t("applications.waiting.title")}>
      <Flex vertical gap="small">
        {waiting.map((entry) => (
          <Flex vertical key={`${entry.action}-${entry.note}`} gap={4}>
            <Tag color="warning" style={{ width: "fit-content" }}>
              {t(`applications.pending.${entry.action}`)}
            </Tag>
            <Typography.Text type="secondary">{entry.note}</Typography.Text>
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}
