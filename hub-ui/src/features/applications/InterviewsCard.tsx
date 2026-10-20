import { EnvironmentOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Badge, Button, Card, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationReference,
  MyApplicationInterview,
} from "typespec/hub/applications/applications";
import { hubAPI } from "../../api/hub";
import { ActionError } from "./ActionError";
import { useApplicationAction } from "./actions";
import { RescheduleDialog } from "./RescheduleDialog";

function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function InterviewItem({
  reference,
  interview,
}: {
  reference: ApplicationReference;
  interview: MyApplicationInterview;
}) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const [rescheduling, setRescheduling] = useState(false);
  const accept = useApplicationAction((number: number, key) =>
    hubAPI.acceptApplicationInterview(
      { ...reference, interview_number: number },
      key,
    ),
  );
  const reschedule = useApplicationAction(
    (request: { number: number; note: string }, key) =>
      hubAPI.requestApplicationInterviewReschedule(
        {
          ...reference,
          interview_number: request.number,
          note: request.note,
        },
        key,
      ),
  );
  const cancelled = interview.state === "cancelled";
  const answerable =
    !cancelled &&
    interview.response === "pending" &&
    Date.parse(interview.starts_at) > Date.now();
  const link = interview.video_url ? safeLink(interview.video_url) : null;
  return (
    <Card
      size="small"
      title={
        <Space wrap>
          {t("applications.interviews.number", {
            number: interview.interview_number,
          })}
          {cancelled ? (
            <Tag>{t("applications.interviews.cancelled")}</Tag>
          ) : interview.response === "accepted" ? (
            <Tag color="success">{t("applications.interviews.accepted")}</Tag>
          ) : interview.response === "reschedule_requested" ? (
            <Tag color="processing">
              {t("applications.interviews.rescheduleRequested")}
            </Tag>
          ) : answerable ? (
            <Tag color="warning">
              {t("applications.interviews.needsAnswer")}
            </Tag>
          ) : null}
        </Space>
      }
    >
      <Space orientation="vertical" className="full-width">
        <Typography.Text strong>
          {t("applications.interviews.when", {
            when: dateTime(interview.starts_at),
            minutes: interview.duration_minutes,
          })}
        </Typography.Text>
        {interview.mode === "video" && link !== null ? (
          <Typography.Link
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            <VideoCameraOutlined /> {link}
          </Typography.Link>
        ) : null}
        {interview.mode === "in_person" && interview.location ? (
          <Typography.Text>
            <EnvironmentOutlined /> {interview.location}
          </Typography.Text>
        ) : null}
        {interview.response === "reschedule_requested" &&
        interview.reschedule_note ? (
          <Typography.Text type="secondary">
            {t("applications.interviews.yourNote", {
              note: interview.reschedule_note,
            })}
          </Typography.Text>
        ) : null}
        {answerable ? (
          <Space wrap>
            <Button
              type="primary"
              loading={accept.isPending}
              disabled={reschedule.isPending}
              onClick={() => accept.mutate(interview.interview_number)}
            >
              {t("applications.interviews.accept")}
            </Button>
            <Button
              disabled={accept.isPending}
              onClick={() => setRescheduling(true)}
            >
              {t("applications.interviews.requestAnotherTime")}
            </Button>
          </Space>
        ) : null}
        <ActionError error={accept.error} />
      </Space>
      <RescheduleDialog
        open={rescheduling}
        pending={reschedule.isPending}
        error={reschedule.error}
        onCancel={() => {
          setRescheduling(false);
          reschedule.reset();
        }}
        onSubmit={(note) =>
          reschedule.mutate(
            { number: interview.interview_number, note },
            { onSuccess: () => setRescheduling(false) },
          )
        }
      />
    </Card>
  );
}

export function InterviewsCard({
  reference,
  interviews,
}: {
  reference: ApplicationReference;
  interviews: MyApplicationInterview[];
}) {
  const { t } = useTranslation();
  if (interviews.length === 0) return null;
  const waiting = interviews.filter(
    (interview) =>
      interview.state === "scheduled" &&
      interview.response === "pending" &&
      Date.parse(interview.starts_at) > Date.now(),
  ).length;
  return (
    <Card
      title={
        <Space>
          {t("applications.interviews.title")}
          <Badge count={waiting} />
        </Space>
      }
    >
      <Space orientation="vertical" className="full-width">
        {interviews.map((interview) => (
          <InterviewItem
            key={interview.interview_number}
            reference={reference}
            interview={interview}
          />
        ))}
      </Space>
    </Card>
  );
}
