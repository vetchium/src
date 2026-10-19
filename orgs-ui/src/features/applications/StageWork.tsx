import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Card, Descriptions, Flex, List, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import { stageKindLabel, useCalendarDate } from "./presentation";

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
export function StageWork({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const calendarDate = useCalendarDate();
  if (detail.removed) return null;
  return (
    <>
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
                        </Flex>
                        {result?.notes && (
                          <Typography.Text type="secondary">
                            {result.notes}
                          </Typography.Text>
                        )}
                      </Flex>
                    );
                  })}
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
    </>
  );
}
