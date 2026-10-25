import {
  LinkOutlined,
  PlusOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Avatar,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type {
  AssessmentOutcome,
  CheckOutcome,
  Interview,
  InterviewOutcome,
  InterviewRecommendation,
} from "typespec/orgs/applications/applications";
import type { CheckType } from "typespec/orgs/hiring/vocabulary";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import {
  assessmentOutcomeLabel,
  capabilityColors,
  capabilityLabel,
  checkOutcomeLabel,
  checkTypeLabel,
  workStatusColors,
  workStatusLabel,
} from "../features/marketplace/presentation";
import {
  useCancelWorkInterviewMutation,
  useChangeWorkInterviewMutation,
  useRecordWorkAssessmentMutation,
  useRecordWorkBackgroundCheckResultMutation,
  useRecordWorkInterviewOutcomeMutation,
  useScheduleWorkInterviewMutation,
  useSubmitWorkInterviewFeedbackMutation,
  useWorkItemQuery,
} from "../features/marketplace/queries";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts[parts.length - 1]?.charAt(0) ?? "";
  if (parts.length === 0) return "C";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "C";
  return (first + last).toUpperCase();
}

/** Formats a Date to datetime-local input string `YYYY-MM-DDTHH:mm`. */
function toLocalInput(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WorkItemDetailPage() {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const { message: toast } = App.useApp();
  const { engagementId, workId } = useParams<{
    engagementId: string;
    workId: string;
  }>();

  const reference = useMemo(() => {
    if (!engagementId || !workId) return undefined;
    return { engagement_id: engagementId, work_id: workId };
  }, [engagementId, workId]);

  const myInfoQuery = useMyInfoQuery();
  const me = myInfoQuery.data;

  const workItemQuery = useWorkItemQuery(reference);
  const detail = workItemQuery.data;

  // Mutations
  const scheduleMutation = useScheduleWorkInterviewMutation(
    reference ?? { engagement_id: "", work_id: "" },
  );
  const changeMutation = useChangeWorkInterviewMutation(
    reference ?? { engagement_id: "", work_id: "" },
  );
  const cancelMutation = useCancelWorkInterviewMutation(
    reference ?? { engagement_id: "", work_id: "" },
  );
  const outcomeMutation = useRecordWorkInterviewOutcomeMutation(
    reference ?? { engagement_id: "", work_id: "" },
  );
  const feedbackMutation = useSubmitWorkInterviewFeedbackMutation(
    reference ?? { engagement_id: "", work_id: "" },
  );
  const assessmentMutation = useRecordWorkAssessmentMutation(
    reference ?? { engagement_id: "", work_id: "" },
  );
  const checkMutation = useRecordWorkBackgroundCheckResultMutation(
    reference ?? { engagement_id: "", work_id: "" },
  );

  const scheduleKey = useIdempotencyKey("schedule-work-interview");
  const changeKey = useIdempotencyKey("change-work-interview");
  const cancelKey = useIdempotencyKey("cancel-work-interview");
  const outcomeKey = useIdempotencyKey("outcome-work-interview");
  const feedbackKey = useIdempotencyKey("feedback-work-interview");
  const assessmentKey = useIdempotencyKey("record-work-assessment");
  const checkKey = useIdempotencyKey("record-work-check");

  // Interview modals state
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [changeTarget, setChangeTarget] = useState<Interview>();
  const [cancelTarget, setCancelTarget] = useState<Interview>();
  const [outcomeTarget, setOutcomeTarget] = useState<Interview>();
  const [feedbackTarget, setFeedbackTarget] = useState<Interview>();

  // Interview form state
  const [interviewStart, setInterviewStart] = useState("");
  const [interviewMinutes, setInterviewMinutes] = useState(45);
  const [interviewMode, setInterviewMode] = useState<"video" | "in_person">(
    "video",
  );
  const [interviewVideoUrl, setInterviewVideoUrl] = useState("");
  const [interviewLocation, setInterviewLocation] = useState("");
  const [interviewerEmails, setInterviewerEmails] = useState<string[]>([]);

  // Outcome & feedback state
  const [selectedOutcome, setSelectedOutcome] =
    useState<InterviewOutcome>("completed");
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<InterviewRecommendation>("strong_yes");
  const [feedbackNotes, setFeedbackNotes] = useState("");

  // Assessment form state
  const [assessmentOutcome, setAssessmentOutcome] =
    useState<AssessmentOutcome>("pass");
  const [assessmentScore, setAssessmentScore] = useState<number | null>(null);
  const [assessmentNotes, setAssessmentNotes] = useState("");
  const [assessmentReportUrl, setAssessmentReportUrl] = useState("");

  // Background check outcome state
  const [recordingCheckType, setRecordingCheckType] = useState<CheckType>();
  const [checkOutcome, setCheckOutcome] = useState<CheckOutcome>("clear");
  const [checkNotes, setCheckNotes] = useState("");
  const [checkReportUrl, setCheckReportUrl] = useState("");

  if (!reference) {
    return (
      <Alert
        type="error"
        showIcon
        title={t("marketplace.work.invalidReference")}
      />
    );
  }

  if (workItemQuery.isLoading) {
    return <Card loading />;
  }

  if (workItemQuery.isError || !detail) {
    return (
      <Alert type="error" showIcon title={t("marketplace.work.notFound")} />
    );
  }

  const { item, snapshot, cover_note } = detail;

  const handleScheduleSubmit = async () => {
    const emails =
      interviewerEmails.length > 0
        ? interviewerEmails
        : me?.email_address
          ? [me.email_address]
          : [];
    if (!interviewStart || emails.length === 0) return;
    try {
      await scheduleMutation.mutateAsync({
        request: {
          engagement_id: reference.engagement_id,
          work_id: reference.work_id,
          start_time: new Date(interviewStart).toISOString(),
          duration_minutes: interviewMinutes,
          mode: interviewMode,
          video_url:
            interviewMode === "video"
              ? interviewVideoUrl.trim() || undefined
              : undefined,
          location:
            interviewMode === "in_person"
              ? interviewLocation.trim() || undefined
              : undefined,
          interviewer_emails: emails,
        },
        key: scheduleKey.current(),
      });
      scheduleKey.rotate();
      setScheduleOpen(false);
      void toast.success(t("marketplace.work.interviewScheduled"));
    } catch {
      void toast.error(t("marketplace.work.interviewScheduleError"));
    }
  };

  const handleChangeSubmit = async () => {
    const emails =
      interviewerEmails.length > 0
        ? interviewerEmails
        : me?.email_address
          ? [me.email_address]
          : [];
    if (!changeTarget || !interviewStart || emails.length === 0) return;
    try {
      await changeMutation.mutateAsync({
        request: {
          engagement_id: reference.engagement_id,
          work_id: reference.work_id,
          interview_number: changeTarget.interview_number,
          start_time: new Date(interviewStart).toISOString(),
          duration_minutes: interviewMinutes,
          mode: interviewMode,
          video_url:
            interviewMode === "video"
              ? interviewVideoUrl.trim() || undefined
              : undefined,
          location:
            interviewMode === "in_person"
              ? interviewLocation.trim() || undefined
              : undefined,
          interviewer_emails: emails,
        },
        key: changeKey.current(),
      });
      changeKey.rotate();
      setChangeTarget(undefined);
      void toast.success(t("marketplace.work.interviewChanged"));
    } catch {
      void toast.error(t("marketplace.work.interviewChangeError"));
    }
  };

  const handleCancelSubmit = async () => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync({
        request: {
          engagement_id: reference.engagement_id,
          work_id: reference.work_id,
          interview_number: cancelTarget.interview_number,
        },
        key: cancelKey.current(),
      });
      cancelKey.rotate();
      setCancelTarget(undefined);
      void toast.success(t("marketplace.work.interviewCancelled"));
    } catch {
      void toast.error(t("marketplace.work.interviewCancelError"));
    }
  };

  const handleOutcomeSubmit = async () => {
    if (!outcomeTarget) return;
    try {
      await outcomeMutation.mutateAsync({
        request: {
          engagement_id: reference.engagement_id,
          work_id: reference.work_id,
          interview_number: outcomeTarget.interview_number,
          outcome: selectedOutcome,
        },
        key: outcomeKey.current(),
      });
      outcomeKey.rotate();
      setOutcomeTarget(undefined);
      void toast.success(t("marketplace.work.outcomeRecorded"));
    } catch {
      void toast.error(t("marketplace.work.outcomeError"));
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackTarget) return;
    try {
      await feedbackMutation.mutateAsync({
        request: {
          engagement_id: reference.engagement_id,
          work_id: reference.work_id,
          interview_number: feedbackTarget.interview_number,
          recommendation: selectedRecommendation,
          notes: feedbackNotes.trim(),
        },
        key: feedbackKey.current(),
      });
      feedbackKey.rotate();
      setFeedbackTarget(undefined);
      setFeedbackNotes("");
      void toast.success(t("marketplace.work.feedbackSubmitted"));
    } catch {
      void toast.error(t("marketplace.work.feedbackError"));
    }
  };

  const handleAssessmentSubmit = async () => {
    try {
      await assessmentMutation.mutateAsync({
        request: {
          engagement_id: reference.engagement_id,
          work_id: reference.work_id,
          outcome: assessmentOutcome,
          score: assessmentScore !== null ? assessmentScore : undefined,
          notes: assessmentNotes.trim() || undefined,
          report_url: assessmentReportUrl.trim() || undefined,
        },
        key: assessmentKey.current(),
      });
      assessmentKey.rotate();
      void toast.success(t("marketplace.work.assessmentRecorded"));
    } catch {
      void toast.error(t("marketplace.work.assessmentError"));
    }
  };

  const handleCheckSubmit = async () => {
    if (!recordingCheckType) return;
    try {
      await checkMutation.mutateAsync({
        request: {
          engagement_id: reference.engagement_id,
          work_id: reference.work_id,
          check_type: recordingCheckType,
          outcome: checkOutcome,
          notes: checkNotes.trim() || undefined,
          report_url: checkReportUrl.trim() || undefined,
        },
        key: checkKey.current(),
      });
      checkKey.rotate();
      setRecordingCheckType(undefined);
      setCheckNotes("");
      setCheckReportUrl("");
      void toast.success(t("marketplace.work.checkOutcomeRecorded"));
    } catch {
      void toast.error(t("marketplace.work.checkOutcomeError"));
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.workQueue}>
                {t("marketplace.workQueue.title")}
              </Link>
            ),
          },
          { title: item.applicant_name },
        ]}
      />

      <div>
        <Flex gap="small" align="center" wrap>
          <Typography.Title level={2} style={{ marginBottom: 0 }}>
            {item.applicant_name}
          </Typography.Title>
          <Tag color={capabilityColors[item.capability]}>
            {capabilityLabel(t, item.capability)}
          </Tag>
          <Tag color={workStatusColors[item.status]}>
            {workStatusLabel(t, item.status)}
          </Tag>
        </Flex>
        <Typography.Text
          type="secondary"
          style={{ marginTop: 4, display: "block" }}
        >
          {item.client.display_name} · #{item.opening.number}{" "}
          {item.opening.title} ·{" "}
          {t("marketplace.work.stage", { stage: item.stage_name })}
        </Typography.Text>
      </div>

      <Alert
        type="info"
        showIcon
        message={t("marketplace.work.routedNotice", {
          capability: capabilityLabel(t, item.capability),
        })}
      />

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          <Flex vertical gap="middle">
            {/* Capability = interviewing */}
            {item.capability === "interviewing" && (
              <Card
                title={t("marketplace.work.interviewsTitle")}
                extra={
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setInterviewStart("");
                      setInterviewMinutes(45);
                      setInterviewMode("video");
                      setInterviewVideoUrl("");
                      setInterviewLocation("");
                      setInterviewerEmails(
                        me?.email_address ? [me.email_address] : [],
                      );
                      setScheduleOpen(true);
                    }}
                  >
                    {t("marketplace.work.scheduleInterview")}
                  </Button>
                }
              >
                {detail.interviews.length === 0 ? (
                  <Typography.Text type="secondary">
                    {t("marketplace.work.noInterviewsScheduled")}
                  </Typography.Text>
                ) : (
                  <Flex vertical gap="small">
                    {detail.interviews.map((int: Interview) => (
                      <Card
                        key={int.interview_number}
                        size="small"
                        title={
                          <Flex gap="small" align="center">
                            <Typography.Text strong>
                              {t("marketplace.work.interviewNumber", {
                                number: int.interview_number,
                              })}
                            </Typography.Text>
                            <Tag color="cyan">
                              {t(
                                `applications.interviews.interviewStates.${int.state}`,
                                {
                                  defaultValue: int.state,
                                },
                              )}
                            </Tag>
                          </Flex>
                        }
                        extra={
                          <Flex gap="small">
                            {int.state === "scheduled" && (
                              <>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setChangeTarget(int);
                                    setInterviewStart(
                                      toLocalInput(int.starts_at),
                                    );
                                    setInterviewMinutes(int.duration_minutes);
                                    setInterviewMode(int.mode);
                                    setInterviewVideoUrl(int.video_url || "");
                                    setInterviewLocation(int.location || "");
                                    setInterviewerEmails(
                                      int.interviewers.map((i) => i.email),
                                    );
                                  }}
                                >
                                  {t("common.change")}
                                </Button>
                                <Button
                                  size="small"
                                  danger
                                  onClick={() => setCancelTarget(int)}
                                >
                                  {t("common.cancel")}
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setOutcomeTarget(int);
                                    setSelectedOutcome("completed");
                                  }}
                                >
                                  {t("marketplace.work.outcomeAction")}
                                </Button>
                              </>
                            )}
                            {int.state === "completed" && (
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => {
                                  setFeedbackTarget(int);
                                  setSelectedRecommendation("strong_yes");
                                  setFeedbackNotes("");
                                }}
                              >
                                {t("marketplace.work.feedbackAction")}
                              </Button>
                            )}
                          </Flex>
                        }
                      >
                        <Descriptions size="small" column={{ xs: 1, md: 2 }}>
                          <Descriptions.Item
                            label={t("marketplace.work.interviewWhen")}
                          >
                            {date(int.starts_at)} · {int.duration_minutes} min
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("marketplace.work.interviewMode")}
                          >
                            {int.mode === "video" ? (
                              <Flex gap={4} align="center">
                                <VideoCameraOutlined />
                                <span>{int.video_url || "Video call"}</span>
                              </Flex>
                            ) : (
                              <span>{int.location || "In person"}</span>
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("marketplace.work.interviewers")}
                          >
                            {int.interviewers.map((i) => i.email).join(", ") ||
                              "—"}
                          </Descriptions.Item>
                          {int.feedback.length > 0 && (
                            <Descriptions.Item
                              label={t("marketplace.work.recordedFeedback")}
                            >
                              <Flex vertical gap="small">
                                {int.feedback.map((f) => (
                                  <Flex vertical key={f.interviewer_email}>
                                    <Flex gap="small" align="center">
                                      <Tag color="blue">
                                        {t(
                                          `applications.work.recommendations.${f.recommendation}`,
                                          { defaultValue: f.recommendation },
                                        )}
                                      </Tag>
                                      <Typography.Text
                                        type="secondary"
                                        style={{ fontSize: 12 }}
                                      >
                                        {f.interviewer_email}
                                      </Typography.Text>
                                    </Flex>
                                    {f.notes ? (
                                      <Typography.Text
                                        style={{
                                          whiteSpace: "pre-wrap",
                                          marginTop: 4,
                                        }}
                                      >
                                        {f.notes}
                                      </Typography.Text>
                                    ) : null}
                                  </Flex>
                                ))}
                              </Flex>
                            </Descriptions.Item>
                          )}
                        </Descriptions>
                      </Card>
                    ))}
                  </Flex>
                )}
              </Card>
            )}

            {/* Capability = assessment */}
            {item.capability === "assessment" && (
              <Card title={t("marketplace.work.assessmentTitle")}>
                {detail.assessment ? (
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label={t("marketplace.work.outcome")}>
                      <Tag
                        color={
                          detail.assessment.outcome === "pass"
                            ? "success"
                            : detail.assessment.outcome === "fail"
                              ? "error"
                              : "default"
                        }
                      >
                        {assessmentOutcomeLabel(t, detail.assessment.outcome)}
                      </Tag>
                    </Descriptions.Item>
                    {detail.assessment.score !== undefined && (
                      <Descriptions.Item label={t("marketplace.work.score")}>
                        {detail.assessment.score}
                      </Descriptions.Item>
                    )}
                    {detail.assessment.notes && (
                      <Descriptions.Item label={t("marketplace.work.notes")}>
                        {detail.assessment.notes}
                      </Descriptions.Item>
                    )}
                    {detail.assessment.report_url && (
                      <Descriptions.Item
                        label={t("marketplace.work.reportLink")}
                      >
                        <a
                          href={detail.assessment.report_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {detail.assessment.report_url}
                        </a>
                      </Descriptions.Item>
                    )}
                    <Descriptions.Item label={t("marketplace.work.recordedAt")}>
                      {date(detail.assessment.recorded_at)}
                    </Descriptions.Item>
                  </Descriptions>
                ) : (
                  <Form layout="vertical">
                    <Form.Item label={t("marketplace.work.outcome")} required>
                      <Radio.Group
                        value={assessmentOutcome}
                        onChange={(e) => setAssessmentOutcome(e.target.value)}
                        options={[
                          {
                            value: "pass",
                            label: t("applications.work.outcomes.pass"),
                          },
                          {
                            value: "fail",
                            label: t("applications.work.outcomes.fail"),
                          },
                          {
                            value: "inconclusive",
                            label: t("applications.work.outcomes.inconclusive"),
                          },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label={t("marketplace.work.score")}>
                      <InputNumber
                        min={0}
                        max={100}
                        value={assessmentScore}
                        onChange={setAssessmentScore}
                      />
                    </Form.Item>
                    <Form.Item label={t("marketplace.work.notes")}>
                      <Input.TextArea
                        rows={3}
                        maxLength={2000}
                        value={assessmentNotes}
                        onChange={(e) => setAssessmentNotes(e.target.value)}
                      />
                    </Form.Item>
                    <Form.Item label={t("marketplace.work.reportLink")}>
                      <Input
                        prefix={<LinkOutlined />}
                        value={assessmentReportUrl}
                        onChange={(e) => setAssessmentReportUrl(e.target.value)}
                        placeholder="https://…"
                      />
                    </Form.Item>
                    <Button
                      type="primary"
                      loading={assessmentMutation.isPending}
                      onClick={() => void handleAssessmentSubmit()}
                    >
                      {t("marketplace.work.recordAssessment")}
                    </Button>
                  </Form>
                )}
              </Card>
            )}

            {/* Capability = background_check */}
            {item.capability === "background_check" &&
              detail.background_check && (
                <Card
                  title={t("marketplace.work.checksTitle")}
                  extra={
                    detail.background_check.consent_state === "given" ? (
                      <Tag color="success">
                        {t("marketplace.work.consentGiven", {
                          date: date(detail.background_check.requested_at),
                        })}
                      </Tag>
                    ) : (
                      <Tag color="warning">
                        {t("marketplace.work.awaitingConsent")}
                      </Tag>
                    )
                  }
                >
                  <Typography.Paragraph type="secondary">
                    {t("marketplace.work.checksIntro")}
                  </Typography.Paragraph>

                  <Flex vertical gap="small">
                    {detail.background_check.check_types.map(
                      (type: CheckType) => {
                        const result = detail.background_check?.results.find(
                          (r) => r.check_type === type,
                        );

                        return (
                          <Card
                            key={type}
                            size="small"
                            title={checkTypeLabel(t, type)}
                            extra={
                              result ? (
                                <Tag
                                  color={
                                    result.outcome === "clear"
                                      ? "success"
                                      : result.outcome === "discrepancy"
                                        ? "warning"
                                        : "volcano"
                                  }
                                >
                                  {checkOutcomeLabel(t, result.outcome)} ·{" "}
                                  {date(result.recorded_at)}
                                </Tag>
                              ) : (
                                <Tag>{t("marketplace.work.checkPending")}</Tag>
                              )
                            }
                          >
                            {result ? (
                              <div>
                                {result.notes && (
                                  <Typography.Paragraph
                                    style={{ marginBottom: 4 }}
                                  >
                                    {result.notes}
                                  </Typography.Paragraph>
                                )}
                                {result.report_url && (
                                  <a
                                    href={result.report_url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <LinkOutlined /> {result.report_url}
                                  </a>
                                )}
                              </div>
                            ) : detail.background_check?.consent_state ===
                              "given" ? (
                              recordingCheckType === type ? (
                                <Form layout="vertical">
                                  <Form.Item
                                    label={t("marketplace.work.outcome")}
                                    required
                                  >
                                    <Radio.Group
                                      value={checkOutcome}
                                      onChange={(e) =>
                                        setCheckOutcome(e.target.value)
                                      }
                                      options={[
                                        {
                                          value: "clear",
                                          label: t(
                                            "applications.work.checkOutcomes.clear",
                                          ),
                                        },
                                        {
                                          value: "discrepancy",
                                          label: t(
                                            "applications.work.checkOutcomes.discrepancy",
                                          ),
                                        },
                                        {
                                          value: "unable_to_verify",
                                          label: t(
                                            "applications.work.checkOutcomes.unable_to_verify",
                                          ),
                                        },
                                      ]}
                                    />
                                  </Form.Item>
                                  <Form.Item
                                    label={t("marketplace.work.notes")}
                                  >
                                    <Input.TextArea
                                      rows={2}
                                      maxLength={2000}
                                      value={checkNotes}
                                      onChange={(e) =>
                                        setCheckNotes(e.target.value)
                                      }
                                    />
                                  </Form.Item>
                                  <Form.Item
                                    label={t("marketplace.work.reportLink")}
                                  >
                                    <Input
                                      prefix={<LinkOutlined />}
                                      value={checkReportUrl}
                                      onChange={(e) =>
                                        setCheckReportUrl(e.target.value)
                                      }
                                      placeholder="https://…"
                                    />
                                  </Form.Item>
                                  <Flex gap="small">
                                    <Button
                                      type="primary"
                                      loading={checkMutation.isPending}
                                      onClick={() => void handleCheckSubmit()}
                                    >
                                      {t("marketplace.work.submitOutcome")}
                                    </Button>
                                    <Button
                                      onClick={() =>
                                        setRecordingCheckType(undefined)
                                      }
                                    >
                                      {t("common.cancel")}
                                    </Button>
                                  </Flex>
                                </Form>
                              ) : (
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setRecordingCheckType(type);
                                    setCheckOutcome("clear");
                                    setCheckNotes("");
                                    setCheckReportUrl("");
                                  }}
                                >
                                  {t("marketplace.work.recordOutcome")}
                                </Button>
                              )
                            ) : (
                              <Typography.Text type="secondary">
                                {t("marketplace.work.awaitingConsentText")}
                              </Typography.Text>
                            )}
                          </Card>
                        );
                      },
                    )}
                  </Flex>
                </Card>
              )}

            {/* What you don't see */}
            <Card title={t("marketplace.work.whatYouDontSeeTitle")}>
              <Typography.Text type="secondary">
                {t("marketplace.work.whatYouDontSeeText")}
              </Typography.Text>
            </Card>
          </Flex>
        </Col>

        {/* Right col: Candidate snapshot */}
        <Col xs={24} lg={9}>
          <Flex vertical gap="middle">
            <Card title={t("applications.snapshot.title")}>
              <Flex gap="middle" align="center" style={{ marginBottom: 16 }}>
                <Avatar size={48} style={{ backgroundColor: "#2563eb" }}>
                  {getInitials(snapshot.display_name)}
                </Avatar>
                <div>
                  <Typography.Text
                    strong
                    style={{ fontSize: 16, display: "block" }}
                  >
                    {snapshot.display_name}
                  </Typography.Text>
                  {snapshot.resident_country && (
                    <Typography.Text type="secondary">
                      {snapshot.resident_country}
                    </Typography.Text>
                  )}
                </div>
              </Flex>

              {snapshot.biography && (
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    {t("applications.snapshot.about")}
                  </Typography.Text>
                  <Typography.Paragraph
                    type="secondary"
                    style={{ marginTop: 4, whiteSpace: "pre-wrap" }}
                  >
                    {snapshot.biography}
                  </Typography.Paragraph>
                </div>
              )}

              {snapshot.work_experiences.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    {t("applications.snapshot.work")}
                  </Typography.Text>
                  <Flex vertical gap={6} style={{ marginTop: 4 }}>
                    {snapshot.work_experiences.map((w) => (
                      <div key={w.id}>
                        <Typography.Text style={{ display: "block" }}>
                          {w.job_title} · {w.employer_domain}
                        </Typography.Text>
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          {w.start_month} –{" "}
                          {w.end_month || t("applications.snapshot.present")}
                        </Typography.Text>
                      </div>
                    ))}
                  </Flex>
                </div>
              )}

              {snapshot.educational_qualifications.length > 0 && (
                <div>
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    {t("applications.snapshot.education")}
                  </Typography.Text>
                  <Flex vertical gap={6} style={{ marginTop: 4 }}>
                    {snapshot.educational_qualifications.map((ed) => (
                      <div key={ed.id}>
                        <Typography.Text style={{ display: "block" }}>
                          {[ed.degree, ed.title, ed.institution_domain]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography.Text>
                      </div>
                    ))}
                  </Flex>
                </div>
              )}
            </Card>

            {cover_note && (
              <Card title={t("applications.coverNote")}>
                <Typography.Paragraph
                  style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
                >
                  {cover_note}
                </Typography.Paragraph>
              </Card>
            )}
          </Flex>
        </Col>
      </Row>

      {/* Modal: Schedule interview */}
      <Modal
        title={t("marketplace.work.scheduleInterview")}
        open={scheduleOpen}
        onCancel={() => setScheduleOpen(false)}
        onOk={() => void handleScheduleSubmit()}
        okText={t("marketplace.work.scheduleInterview")}
        okButtonProps={{ loading: scheduleMutation.isPending }}
      >
        <Form layout="vertical">
          <Form.Item label={t("marketplace.work.interviewStart")} required>
            <Input
              type="datetime-local"
              value={interviewStart}
              onChange={(e) => setInterviewStart(e.target.value)}
            />
          </Form.Item>
          <Form.Item label={t("marketplace.work.durationMinutes")} required>
            <InputNumber
              min={15}
              max={240}
              step={15}
              value={interviewMinutes}
              onChange={(val) => setInterviewMinutes(val || 45)}
            />
          </Form.Item>
          <Form.Item label={t("marketplace.work.interviewMode")} required>
            <Radio.Group
              value={interviewMode}
              onChange={(e) => setInterviewMode(e.target.value)}
              options={[
                { value: "video", label: t("applications.work.modes.video") },
                {
                  value: "in_person",
                  label: t("applications.work.modes.in_person"),
                },
              ]}
            />
          </Form.Item>
          {interviewMode === "video" ? (
            <Form.Item label={t("marketplace.work.videoUrl")} required>
              <Input
                value={interviewVideoUrl}
                onChange={(e) => setInterviewVideoUrl(e.target.value)}
                placeholder="https://meet.…"
              />
            </Form.Item>
          ) : (
            <Form.Item label={t("marketplace.work.location")} required>
              <Input
                value={interviewLocation}
                onChange={(e) => setInterviewLocation(e.target.value)}
                placeholder={t("marketplace.work.locationPlaceholder")}
              />
            </Form.Item>
          )}
          <Form.Item label={t("marketplace.work.interviewers")}>
            <Select
              mode="tags"
              value={interviewerEmails}
              onChange={setInterviewerEmails}
              placeholder="interviewer@agency.example"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: Change interview */}
      <Modal
        title={t("marketplace.work.changeInterviewTitle")}
        open={changeTarget !== undefined}
        onCancel={() => setChangeTarget(undefined)}
        onOk={() => void handleChangeSubmit()}
        okText={t("common.save")}
        okButtonProps={{ loading: changeMutation.isPending }}
      >
        <Form layout="vertical">
          <Form.Item label={t("marketplace.work.interviewStart")} required>
            <Input
              type="datetime-local"
              value={interviewStart}
              onChange={(e) => setInterviewStart(e.target.value)}
            />
          </Form.Item>
          <Form.Item label={t("marketplace.work.durationMinutes")} required>
            <InputNumber
              min={15}
              max={240}
              step={15}
              value={interviewMinutes}
              onChange={(val) => setInterviewMinutes(val || 45)}
            />
          </Form.Item>
          <Form.Item label={t("marketplace.work.interviewMode")} required>
            <Radio.Group
              value={interviewMode}
              onChange={(e) => setInterviewMode(e.target.value)}
              options={[
                { value: "video", label: t("applications.work.modes.video") },
                {
                  value: "in_person",
                  label: t("applications.work.modes.in_person"),
                },
              ]}
            />
          </Form.Item>
          {interviewMode === "video" ? (
            <Form.Item label={t("marketplace.work.videoUrl")}>
              <Input
                value={interviewVideoUrl}
                onChange={(e) => setInterviewVideoUrl(e.target.value)}
              />
            </Form.Item>
          ) : (
            <Form.Item label={t("marketplace.work.location")}>
              <Input
                value={interviewLocation}
                onChange={(e) => setInterviewLocation(e.target.value)}
              />
            </Form.Item>
          )}
          <Form.Item label={t("marketplace.work.interviewers")}>
            <Select
              mode="tags"
              value={interviewerEmails}
              onChange={setInterviewerEmails}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: Cancel interview */}
      <Modal
        title={t("marketplace.work.cancelInterviewTitle")}
        open={cancelTarget !== undefined}
        onCancel={() => setCancelTarget(undefined)}
        onOk={() => void handleCancelSubmit()}
        okText={t("common.cancel")}
        okButtonProps={{ danger: true, loading: cancelMutation.isPending }}
      >
        <Typography.Paragraph>
          {t("marketplace.work.cancelInterviewText")}
        </Typography.Paragraph>
      </Modal>

      {/* Modal: Record interview outcome */}
      <Modal
        title={t("marketplace.work.outcomeAction")}
        open={outcomeTarget !== undefined}
        onCancel={() => setOutcomeTarget(undefined)}
        onOk={() => void handleOutcomeSubmit()}
        okText={t("marketplace.work.submitOutcome")}
        okButtonProps={{ loading: outcomeMutation.isPending }}
      >
        <Form layout="vertical">
          <Form.Item label={t("marketplace.work.outcome")} required>
            <Radio.Group
              value={selectedOutcome}
              onChange={(e) => setSelectedOutcome(e.target.value)}
              options={[
                {
                  value: "completed",
                  label: t("applications.work.interviewStates.completed"),
                },
                {
                  value: "no_show",
                  label: t("applications.work.interviewStates.no_show"),
                },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: Submit interview feedback */}
      <Modal
        title={t("marketplace.work.feedbackAction")}
        open={feedbackTarget !== undefined}
        onCancel={() => setFeedbackTarget(undefined)}
        onOk={() => void handleFeedbackSubmit()}
        okText={t("marketplace.work.submitFeedback")}
        okButtonProps={{ loading: feedbackMutation.isPending }}
      >
        <Form layout="vertical">
          <Form.Item label={t("applications.work.recommendation")} required>
            <Radio.Group
              value={selectedRecommendation}
              onChange={(e) => setSelectedRecommendation(e.target.value)}
              options={[
                {
                  value: "strong_yes",
                  label: t("applications.work.recommendations.strong_yes"),
                },
                {
                  value: "yes",
                  label: t("applications.work.recommendations.yes"),
                },
                {
                  value: "no",
                  label: t("applications.work.recommendations.no"),
                },
                {
                  value: "strong_no",
                  label: t("applications.work.recommendations.strong_no"),
                },
              ]}
            />
          </Form.Item>
          <Form.Item label={t("applications.work.notes")} required>
            <Input.TextArea
              rows={4}
              maxLength={10000}
              value={feedbackNotes}
              onChange={(e) => setFeedbackNotes(e.target.value)}
              placeholder={t("applications.work.feedbackPlaceholder")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
