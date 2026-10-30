import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  List,
  Select,
  Tag,
  Typography,
} from "antd";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationDetail,
  Interview,
} from "typespec/orgs/applications/applications";
import type { CheckType } from "typespec/orgs/hiring/vocabulary";
import { useMyInfoQuery } from "../account/queries";
import {
  useOpeningProvidersQuery,
  useRouteApplicationMutation,
} from "../marketplace/queries";
import { CheckResultDialog } from "./CheckResultDialog";
import { FeedbackComparison } from "./FeedbackComparison";
import { InterviewDialog } from "./InterviewDialog";
import { InterviewFeedbackDialog } from "./InterviewFeedbackDialog";
import {
  type InterviewStatusAction,
  InterviewStatusDialog,
} from "./InterviewStatusDialog";
import { applicantName, stageKindLabel, useCalendarDate } from "./presentation";

type Dialog =
  | { kind: "change"; interview: Interview }
  | { kind: "status"; action: InterviewStatusAction; interview: Interview }
  | { kind: "feedback"; interview: Interview }
  | { kind: "check"; checkType: CheckType };

interface Props {
  detail: ApplicationDetail;
  openingNumber: number;
  /** The caller may act on every application of the Opening. */
  canAct: boolean;
  /** People offered when changing an interview's interviewers. */
  suggestions: readonly string[];
}

function ExternalReport({ href, label }: { href: string; label: string }) {
  if (!href.startsWith("https://")) return <>{href}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {label}
    </a>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card title={title}>{children}</Card>;
}

/**
 * What the Org's people have recorded on the application: interviews and
 * feedback, assessment and background-check results, and offers. Each block
 * shows only what the API returned, which already holds back what the caller
 * may not read. Their actions (scheduling, recording, extending) belong
 * beside these blocks.
 */
export function StageWork({
  detail,
  openingNumber,
  canAct,
  suggestions,
}: Props) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const calendarDate = useCalendarDate();
  const { data: me } = useMyInfoQuery();
  const { message: toast } = App.useApp();
  const [dialog, setDialog] = useState<Dialog>();

  const openingProviders = useOpeningProvidersQuery(openingNumber);
  const routeMutation = useRouteApplicationMutation(
    openingNumber,
    detail.application_number,
  );
  const routeKey = useIdempotencyKey(
    `route-app:${openingNumber}:${detail.application_number}`,
  );

  const stageAssignments =
    detail.current_stage !== undefined
      ? (openingProviders.data?.stages.find(
          (s) => s.stage.id === detail.current_stage?.id,
        )?.assignments ?? [])
      : [];

  if (detail.removed) return null;
  const now = Date.now();
  return (
    <>
      {detail.current_stage &&
        detail.state === "in_pipeline" &&
        (stageAssignments.length > 0 || detail.route) && (
          <Card
            title={`${detail.current_stage.name} · ${t("applications.currentStage")}`}
            extra={
              <Flex gap="small" align="center">
                <Typography.Text type="secondary">
                  {t("applications.performedBy")}
                </Typography.Text>
                <Select
                  style={{ minWidth: 200 }}
                  value={detail.route?.engagement_id ?? ""}
                  disabled={!canAct || routeMutation.isPending}
                  onChange={async (val) => {
                    try {
                      await routeMutation.mutateAsync({
                        request: {
                          opening_number: openingNumber,
                          application_number: detail.application_number,
                          version: detail.version,
                          engagement_id: val || undefined,
                        },
                        key: routeKey.current(),
                      });
                      routeKey.rotate();
                      void toast.success(t("applications.routeSaved"));
                    } catch {
                      void toast.error(t("applications.routeError"));
                    }
                  }}
                  options={[
                    { value: "", label: t("applications.inHouse") },
                    ...stageAssignments.map((a) => ({
                      value: a.engagement_id,
                      label: a.counterparty.display_name,
                    })),
                  ]}
                />
              </Flex>
            }
          >
            {detail.route && (
              <Alert
                type="info"
                showIcon
                message={t("applications.routedNotice", {
                  provider: detail.route.provider.display_name,
                  candidate: applicantName(t, {
                    display_name: detail.snapshot.display_name,
                    removed: detail.removed,
                  }),
                })}
              />
            )}
          </Card>
        )}
      {detail.interviews.length > 0 && (
        <Section title={t("applications.work.interviews")}>
          <List
            dataSource={detail.interviews}
            rowKey="interview_number"
            renderItem={(interview) => (
              <List.Item>
                <Flex vertical gap="small" className="full-width">
                  <Flex gap="small" wrap align="center">
                    <Typography.Text strong>
                      {t("applications.work.interview", {
                        number: interview.interview_number,
                      })}
                    </Typography.Text>
                    <Tag>
                      {t(
                        `applications.work.interviewStates.${interview.state}`,
                        { defaultValue: interview.state },
                      )}
                    </Tag>
                    {interview.state === "scheduled" && (
                      <Tag
                        color={
                          interview.applicant_response === "pending"
                            ? "warning"
                            : interview.applicant_response === "accepted"
                              ? "success"
                              : "gold"
                        }
                      >
                        {t(
                          `applications.work.responses.${interview.applicant_response}`,
                          { defaultValue: interview.applicant_response },
                        )}
                      </Tag>
                    )}
                    <Typography.Text type="secondary">
                      {interview.stage.name} (
                      {stageKindLabel(t, interview.stage.kind)})
                    </Typography.Text>
                  </Flex>
                  <Descriptions
                    size="small"
                    column={1}
                    items={[
                      {
                        key: "when",
                        label: t("applications.work.when"),
                        children: t("applications.work.whenValue", {
                          start: dateTime(interview.starts_at),
                          minutes: interview.duration_minutes,
                        }),
                      },
                      {
                        key: "mode",
                        label: t("applications.work.mode"),
                        children:
                          interview.mode === "video" && interview.video_url ? (
                            <ExternalReport
                              href={interview.video_url}
                              label={interview.video_url.replace(
                                /^https:\/\//,
                                "",
                              )}
                            />
                          ) : (
                            (interview.location ??
                            t("applications.work.modes.in_person"))
                          ),
                      },
                      {
                        key: "interviewers",
                        label: t("applications.work.interviewers"),
                        children: interview.interviewers
                          .map((entry) =>
                            entry.feedback_submitted
                              ? t("applications.work.interviewerSubmitted", {
                                  email: entry.email,
                                })
                              : entry.email,
                          )
                          .join(", "),
                      },
                    ]}
                  />
                  {interview.reschedule_note && (
                    <Typography.Text type="warning">
                      {t("applications.work.rescheduleNote", {
                        note: interview.reschedule_note,
                      })}
                    </Typography.Text>
                  )}
                  {interview.feedback.map((feedback) => (
                    <Flex vertical key={feedback.interviewer_email}>
                      <Typography.Text>
                        {t("applications.work.feedbackBy", {
                          email: feedback.interviewer_email,
                          recommendation: t(
                            `applications.work.recommendations.${feedback.recommendation}`,
                            { defaultValue: feedback.recommendation },
                          ),
                        })}
                      </Typography.Text>
                      <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                        {feedback.notes}
                      </Typography.Text>
                    </Flex>
                  ))}
                  <FeedbackComparison interview={interview} />
                  <InterviewRowActions
                    interview={interview}
                    now={now}
                    canAct={canAct}
                    myEmail={me?.email_address}
                    onChange={() => setDialog({ kind: "change", interview })}
                    onStatus={(action) =>
                      setDialog({ kind: "status", action, interview })
                    }
                    onFeedback={() =>
                      setDialog({ kind: "feedback", interview })
                    }
                  />
                </Flex>
              </List.Item>
            )}
          />
        </Section>
      )}
      {detail.assessments.length > 0 && (
        <Section title={t("applications.work.assessments")}>
          <List
            dataSource={detail.assessments}
            renderItem={(assessment) => (
              <List.Item>
                <Flex vertical gap={4}>
                  <Flex gap="small" wrap align="center">
                    <Typography.Text strong>
                      {assessment.stage.name}
                    </Typography.Text>
                    <Tag>
                      {t(`applications.work.outcomes.${assessment.outcome}`, {
                        defaultValue: assessment.outcome,
                      })}
                    </Tag>
                    {assessment.score !== undefined && (
                      <Typography.Text>
                        {t("applications.work.score", {
                          score: assessment.score,
                        })}
                      </Typography.Text>
                    )}
                  </Flex>
                  {assessment.notes && (
                    <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                      {assessment.notes}
                    </Typography.Text>
                  )}
                  {assessment.report_url && (
                    <ExternalReport
                      href={assessment.report_url}
                      label={t("applications.work.report")}
                    />
                  )}
                  <Typography.Text type="secondary">
                    {t("applications.work.recorded", {
                      date: dateTime(assessment.recorded_at),
                      by:
                        assessment.recorded_by_email ??
                        t("applications.history.actors.system"),
                    })}
                  </Typography.Text>
                </Flex>
              </List.Item>
            )}
          />
        </Section>
      )}
      {detail.background_checks.length > 0 && (
        <Section title={t("applications.work.backgroundChecks")}>
          <List
            dataSource={detail.background_checks}
            renderItem={(check) => (
              <List.Item>
                <Flex vertical gap="small" className="full-width">
                  <Flex gap="small" wrap align="center">
                    <Typography.Text strong>{check.stage.name}</Typography.Text>
                    <Tag>
                      {t(`applications.work.consent.${check.consent_state}`, {
                        defaultValue: check.consent_state,
                      })}
                    </Tag>
                  </Flex>
                  {check.check_types.map((type) => {
                    const result = check.results.find(
                      (entry) => entry.check_type === type,
                    );
                    return (
                      <Flex vertical key={type}>
                        <Flex gap="small" wrap>
                          <Typography.Text>
                            {t(`applications.work.checkTypes.${type}`, {
                              defaultValue: type,
                            })}
                          </Typography.Text>
                          <Tag>
                            {result
                              ? t(
                                  `applications.work.checkOutcomes.${result.outcome}`,
                                  { defaultValue: result.outcome },
                                )
                              : t("applications.work.checkPending")}
                          </Tag>
                          {result?.report_url && (
                            <ExternalReport
                              href={result.report_url}
                              label={t("applications.work.report")}
                            />
                          )}
                          {canAct &&
                            !result &&
                            check.consent_state === "given" &&
                            detail.state === "in_pipeline" &&
                            check.stage.id === detail.current_stage?.id && (
                              <Button
                                size="small"
                                onClick={() =>
                                  setDialog({ kind: "check", checkType: type })
                                }
                              >
                                {t("applications.checkResult.action")}
                              </Button>
                            )}
                        </Flex>
                        {result?.notes && (
                          <Typography.Text type="secondary">
                            {result.notes}
                          </Typography.Text>
                        )}
                      </Flex>
                    );
                  })}
                  {check.consent_state === "requested" && (
                    <Typography.Text type="secondary">
                      {t("applications.work.consentAwaited")}
                    </Typography.Text>
                  )}
                  <Typography.Text type="secondary">
                    {t("applications.work.resultsNotDecided")}
                  </Typography.Text>
                </Flex>
              </List.Item>
            )}
          />
        </Section>
      )}
      {detail.offers.length > 0 && (
        <Section title={t("applications.work.offers")}>
          <List
            dataSource={detail.offers}
            renderItem={(offer) => (
              <List.Item>
                <Flex vertical gap={4}>
                  <Flex gap="small" wrap align="center">
                    <Typography.Text strong>
                      {t("applications.work.offer", {
                        number: offer.offer_number,
                      })}
                    </Typography.Text>
                    <Tag>
                      {t(`applications.work.offerStates.${offer.status}`, {
                        defaultValue: offer.status,
                      })}
                    </Tag>
                    <a
                      href={offer.letter_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("applications.work.letter")}
                    </a>
                  </Flex>
                  <Typography.Text type="secondary">
                    {t("applications.work.offerDates", {
                      extended: dateTime(offer.extended_at),
                      respondBy: dateTime(offer.respond_by),
                    })}
                  </Typography.Text>
                  {offer.proposed_joining_date && (
                    <Typography.Text type="secondary">
                      {t("applications.work.proposedJoining", {
                        date: calendarDate(offer.proposed_joining_date),
                      })}
                    </Typography.Text>
                  )}
                </Flex>
              </List.Item>
            )}
          />
        </Section>
      )}
      {dialog?.kind === "change" && (
        <InterviewDialog
          detail={detail}
          openingNumber={openingNumber}
          interview={dialog.interview}
          suggestions={suggestions}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "status" && (
        <InterviewStatusDialog
          action={dialog.action}
          detail={detail}
          openingNumber={openingNumber}
          interview={dialog.interview}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "feedback" && (
        <InterviewFeedbackDialog
          detail={detail}
          openingNumber={openingNumber}
          interview={dialog.interview}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "check" && (
        <CheckResultDialog
          detail={detail}
          openingNumber={openingNumber}
          checkType={dialog.checkType}
          onClose={() => setDialog(undefined)}
        />
      )}
    </>
  );
}

interface RowActionsProps {
  interview: Interview;
  now: number;
  canAct: boolean;
  myEmail: string | undefined;
  onChange: () => void;
  onStatus: (action: InterviewStatusAction) => void;
  onFeedback: () => void;
}

/**
 * What the caller may do to one interview, by its time and their part in it.
 * Whoever acts on the Opening reschedules and cancels; they or an interviewer
 * record the outcome once the interview started; an interviewer who has not
 * given feedback does so after it is completed.
 */
function InterviewRowActions({
  interview,
  now,
  canAct,
  myEmail,
  onChange,
  onStatus,
  onFeedback,
}: RowActionsProps) {
  const { t } = useTranslation();
  const mine = interview.interviewers.find((entry) => entry.email === myEmail);
  const started = new Date(interview.starts_at).getTime() <= now;
  const upcoming = interview.state === "scheduled" && !started;
  const needsOutcome =
    interview.state === "scheduled" &&
    started &&
    (canAct || mine !== undefined);
  const needsFeedback =
    interview.state === "completed" &&
    mine !== undefined &&
    !mine.feedback_submitted;
  if (!upcoming && !needsOutcome && !needsFeedback) return null;
  return (
    <Flex vertical gap="small">
      {needsFeedback && (
        <Alert type="info" showIcon title={t("applications.feedback.hidden")} />
      )}
      <Flex gap="small" wrap>
        {upcoming && canAct && (
          <>
            <Button size="small" onClick={onChange}>
              {t("applications.interview.change.action")}
            </Button>
            <Button size="small" danger onClick={() => onStatus("cancel")}>
              {t("applications.interview.cancel.action")}
            </Button>
          </>
        )}
        {needsOutcome && (
          <>
            <Button size="small" onClick={() => onStatus("completed")}>
              {t("applications.interview.completed.action")}
            </Button>
            <Button size="small" onClick={() => onStatus("no_show")}>
              {t("applications.interview.no_show.action")}
            </Button>
          </>
        )}
        {needsFeedback && (
          <Button size="small" type="primary" onClick={onFeedback}>
            {t("applications.feedback.action")}
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
