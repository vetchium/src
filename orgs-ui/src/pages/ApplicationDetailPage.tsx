import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Flex,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import { AnswersCard } from "../features/applications/AnswersCard";
import { ApplicationActions } from "../features/applications/ApplicationActions";
import { useCanActOnApplications } from "../features/applications/access";
import { HistoryCard } from "../features/applications/HistoryCard";
import {
  applicantName,
  countryName,
  stateColors,
  stateLabel,
} from "../features/applications/presentation";
import { useApplicationQuery } from "../features/applications/queries";
import { SnapshotCard } from "../features/applications/SnapshotCard";
import { StageProgress } from "../features/applications/StageProgress";
import { StageWork } from "../features/applications/StageWork";
import { WaitingCard } from "../features/applications/WaitingCard";
import { OpeningsBreadcrumb } from "../features/openings/OpeningsBreadcrumb";
import { useOpeningQuery } from "../features/openings/queries";
import { useStageCountsQuery } from "../features/pipelines/queries";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts[parts.length - 1]?.charAt(0) ?? "";
  if (parts.length === 0) return "O";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "O";
  return (first + last).toUpperCase();
}

export function ApplicationDetailPage() {
  const params = useParams();
  const openingNumber = Number(params.number);
  const applicationNumber = Number(params.application);
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const valid =
    Number.isInteger(openingNumber) &&
    openingNumber > 0 &&
    Number.isInteger(applicationNumber) &&
    applicationNumber > 0;
  const query = useApplicationQuery(
    valid ? openingNumber : 0,
    valid ? applicationNumber : 0,
  );
  const opening = useOpeningQuery(valid ? openingNumber : 0);
  const counts = useStageCountsQuery(valid ? openingNumber : 0);
  const me = useMyInfoQuery();
  const canAct = useCanActOnApplications(opening.data);
  const detail = query.data;

  if (!valid) return <Alert type="error" title={t("applications.notFound")} />;
  if (query.isLoading)
    return <Typography.Text>{t("common.loading")}</Typography.Text>;
  if (query.isError || !detail)
    return (
      <Space orientation="vertical" size="large" className="full-width">
        <OpeningsBreadcrumb opening={opening.data} />
        <Alert
          type="error"
          showIcon
          title={t("applications.notFound")}
          action={
            <Space>
              <Button onClick={() => void query.refetch()}>
                {t("common.retry")}
              </Button>
              <Link to={paths.openingDetail(openingNumber)}>
                <Button>{t("applications.backToOpening")}</Button>
              </Link>
            </Space>
          }
        />
      </Space>
    );

  const name = applicantName(t, {
    display_name: detail.snapshot.display_name,
    removed: detail.removed,
  });
  const tab = detail.state === "submitted" ? "applicants" : "candidates";
  const latestJob = detail.snapshot.work_experiences[0];
  const subtitle = [
    ...(detail.removed
      ? []
      : [
          ...(latestJob
            ? [`${latestJob.job_title} · ${latestJob.employer_domain}`]
            : []),
          countryName(i18n.language, detail.snapshot.resident_country),
        ]),
    t("applications.appliedOn", { date: date(detail.submitted_at) }),
  ].join(" · ");
  const stages = counts.data?.stages.map((entry) => entry.stage) ?? [];
  const suggestions = [
    ...new Set(
      [
        opening.data?.hiring_manager?.email,
        opening.data?.recruiter?.email,
        ...(opening.data?.team_members.map((member) => member.email) ?? []),
        me.data?.email_address,
      ].filter((email): email is string => email !== undefined),
    ),
  ];

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("applications.detailTitle", { name })}</title>
      <OpeningsBreadcrumb
        opening={opening.data}
        trail={[
          {
            label: t(`applications.tabs.${tab}`),
            to: `${paths.openingDetail(openingNumber)}?tab=${tab}`,
          },
        ]}
        current={name}
      />
      <div>
        <Typography.Title level={1}>
          {name}{" "}
          <Typography.Text type="secondary">
            {t("applications.applicationNumber", { number: applicationNumber })}
          </Typography.Text>{" "}
          <Tag color={stateColors[detail.state]}>
            {stateLabel(t, detail.state)}
          </Tag>
        </Typography.Title>
        <Typography.Text type="secondary">{subtitle}</Typography.Text>
      </div>
      {detail.joined_count > detail.positions && (
        <Alert
          type="warning"
          showIcon
          title={t("applications.overHired", {
            joined: detail.joined_count,
            positions: detail.positions,
          })}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={{ span: 24, order: 2 }} lg={{ span: 16, order: 1 }}>
          <Flex vertical gap="middle">
            <StageProgress detail={detail} stages={stages} />
            <StageWork
              detail={detail}
              openingNumber={openingNumber}
              canAct={canAct}
              suggestions={suggestions}
            />
            <SnapshotCard detail={detail} />
            <AnswersCard detail={detail} />
            {detail.cover_note && !detail.removed && (
              <Card title={t("applications.coverNote")}>
                <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                  {detail.cover_note}
                </Typography.Text>
              </Card>
            )}
            <HistoryCard
              openingNumber={openingNumber}
              applicationNumber={applicationNumber}
            />
          </Flex>
        </Col>
        <Col xs={{ span: 24, order: 1 }} lg={{ span: 8, order: 2 }}>
          <Flex vertical gap="middle">
            <ApplicationActions
              detail={detail}
              openingNumber={openingNumber}
              stages={stages}
              canAct={canAct}
              suggestions={suggestions}
            />
            <WaitingCard detail={detail} />
            {detail.credited_agency && (
              <Card title={t("applications.referredBy.title")}>
                <Flex align="center" gap="small" wrap>
                  <Avatar size="small" style={{ backgroundColor: "#2563eb" }}>
                    {getInitials(detail.credited_agency.display_name)}
                  </Avatar>
                  <Typography.Text strong>
                    {detail.credited_agency.display_name}
                  </Typography.Text>
                  <Tag
                    color={
                      detail.referral_route === "suggested" ? "purple" : "blue"
                    }
                  >
                    {detail.referral_route === "suggested"
                      ? t("applications.referredBy.suggested")
                      : t("applications.referredBy.declared")}
                  </Tag>
                </Flex>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, display: "block", marginTop: 4 }}
                >
                  {detail.credited_agency.domain}
                </Typography.Text>
                <Typography.Paragraph
                  type="secondary"
                  style={{ marginTop: 8, fontSize: 13, marginBottom: 0 }}
                >
                  {detail.referral_route === "suggested"
                    ? t("applications.referredBy.suggestedHelp")
                    : t("applications.referredBy.declaredHelp")}
                </Typography.Paragraph>
              </Card>
            )}
          </Flex>
        </Col>
      </Row>
    </Space>
  );
}
