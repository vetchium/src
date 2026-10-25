import { SendOutlined, UserOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Avatar,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type {
  JobCreditedApplication,
  JobSuggestedContact,
} from "typespec/orgs/marketplace/work/work";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import { JobOwnerModal } from "../features/marketplace/JobOwnerModal";
import {
  getInitials,
  hubStatusColors,
  hubStatusLabel,
  openingStateColors,
  openingStateLabel,
  referralRouteColors,
  referralRouteLabel,
} from "../features/marketplace/presentation";
import { useJobQuery } from "../features/marketplace/queries";
import { SuggestToContactModal } from "../features/marketplace/SuggestToContactModal";

interface OpeningContent {
  description?: string;
  work_arrangement?: string;
  location_details?: string;
  employment_type?: string;
  positions?: number;
  experience?: string;
  salary_range?: string;
  language?: string;
  [key: string]: unknown;
}

export function JobDetailPage() {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const { engagement_id = "", opening_number = "" } = useParams();
  const openingNum = Number(opening_number);

  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const { data: me } = useMyInfoQuery();

  const jobQuery = useJobQuery(engagement_id, openingNum);
  const detail = jobQuery.data;
  const job = detail?.job;
  const content = detail?.content as OpeningContent | undefined;

  const alreadySuggestedContactIds = useMemo(() => {
    return new Set(
      (detail?.suggested_contacts ?? []).map((sc) => sc.contact_id),
    );
  }, [detail?.suggested_contacts]);

  if (jobQuery.isLoading) {
    return <Card loading style={{ width: "100%" }} />;
  }

  if (!job) {
    return (
      <Card>
        <Typography.Text type="secondary">
          {t("marketplace.jobs.notFound")}
        </Typography.Text>
      </Card>
    );
  }

  const creditedApps = detail?.credited_applications ?? [];
  const suggestedContacts = detail?.suggested_contacts ?? [];

  const creditedColumns: ColumnsType<JobCreditedApplication> = [
    {
      title: t("marketplace.attribution.tableApplication"),
      key: "application_number",
      render: (_, item) => `#${item.application_number}`,
    },
    {
      title: t("marketplace.attribution.tableRoute"),
      key: "route",
      render: (_, item) => (
        <Tag color={referralRouteColors[item.route] ?? "default"}>
          {referralRouteLabel(t, item.route)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.attribution.tableStatus"),
      key: "status",
      render: (_, item) => (
        <Tag color={hubStatusColors[item.status] ?? "default"}>
          {hubStatusLabel(t, item.status)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.attribution.tableApplied"),
      key: "applied_at",
      render: (_, item) => (item.applied_at ? date(item.applied_at) : "—"),
    },
  ];

  const suggestedColumns: ColumnsType<JobSuggestedContact> = [
    {
      title: t("marketplace.contacts.tableName"),
      key: "contact",
      render: (_, item) => (
        <Flex align="center" gap="small">
          <Avatar size="small" style={{ backgroundColor: "#1677ff" }}>
            {getInitials(item.display_name)}
          </Avatar>
          <div>
            <Link
              to={paths.contactDetail(item.contact_id)}
              style={{ fontWeight: 500 }}
            >
              {item.display_name}
            </Link>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                @{item.handle}
              </Typography.Text>
            </div>
          </div>
        </Flex>
      ),
    },
    {
      title: t("marketplace.jobs.suggestedDate"),
      key: "suggested_at",
      render: (_, item) => (item.suggested_at ? date(item.suggested_at) : "—"),
    },
  ];

  const tabItems = [
    {
      key: "opening",
      label: t("marketplace.jobs.tabOpening"),
      children: (
        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: "block", marginBottom: 16 }}
          >
            {t("marketplace.jobs.asCandidatesSeeIt")}
          </Typography.Text>

          {content?.description && (
            <div style={{ marginBottom: 24 }}>
              <Typography.Title level={4} style={{ marginTop: 0 }}>
                {t("marketplace.jobs.aboutTheRole")}
              </Typography.Title>
              <Typography.Paragraph
                style={{ whiteSpace: "pre-line", fontSize: 14 }}
              >
                {String(content.description)}
              </Typography.Paragraph>
            </div>
          )}

          <Descriptions
            column={{ xs: 1, sm: 2 }}
            size="small"
            style={{ marginTop: 16 }}
          >
            {job.opening.employing_country && (
              <Descriptions.Item label={t("openings.fields.employingCountry")}>
                {t(`countries.${job.opening.employing_country}`, {
                  defaultValue: job.opening.employing_country,
                })}
              </Descriptions.Item>
            )}
            {content?.work_arrangement && (
              <Descriptions.Item label={t("openings.fields.workArrangement")}>
                {t(`openings.workArrangements.${content.work_arrangement}`, {
                  defaultValue: content.work_arrangement,
                })}
              </Descriptions.Item>
            )}
            {content?.location_details && (
              <Descriptions.Item label={t("openings.fields.locationDetails")}>
                {content.location_details}
              </Descriptions.Item>
            )}
            {content?.employment_type && (
              <Descriptions.Item label={t("openings.fields.employmentType")}>
                {t(`openings.employmentTypes.${content.employment_type}`, {
                  defaultValue: content.employment_type,
                })}
              </Descriptions.Item>
            )}
            {content?.positions !== undefined && (
              <Descriptions.Item label={t("openings.fields.positions")}>
                {content.positions}
              </Descriptions.Item>
            )}
            {content?.experience && (
              <Descriptions.Item label={t("openings.fields.experience")}>
                {content.experience}
              </Descriptions.Item>
            )}
            {content?.salary_range && (
              <Descriptions.Item label={t("openings.fields.salary")}>
                {content.salary_range}
              </Descriptions.Item>
            )}
            {content?.language && (
              <Descriptions.Item label={t("openings.fields.language")}>
                {content.language}
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>
      ),
    },
    {
      key: "credited",
      label: `${t("marketplace.jobs.tabCredited")} (${creditedApps.length})`,
      children: (
        <Table<JobCreditedApplication>
          rowKey={(item) => item.application_number}
          columns={creditedColumns}
          dataSource={creditedApps}
          pagination={false}
          size="middle"
        />
      ),
    },
    {
      key: "suggested",
      label: `${t("marketplace.jobs.tabSuggested")} (${suggestedContacts.length})`,
      children: (
        <Table<JobSuggestedContact>
          rowKey={(item) => item.contact_id}
          columns={suggestedColumns}
          dataSource={suggestedContacts}
          pagination={false}
          size="middle"
        />
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          { title: <Link to={paths.jobs}>{t("marketplace.jobs.title")}</Link> },
          { title: job.opening.title },
        ]}
      />

      <Flex justify="space-between" align="flex-start" wrap="wrap" gap="middle">
        <div>
          <Flex align="center" gap="small" wrap="wrap">
            <Typography.Title level={2} style={{ margin: 0 }}>
              {job.opening.title}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 18 }}>
              #{job.opening.number}
            </Typography.Text>
            <Tag color={openingStateColors[job.state] ?? "default"}>
              {openingStateLabel(t, job.state)}
            </Tag>
          </Flex>
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            {job.client.display_name || job.client.domain} ·{" "}
            {t("marketplace.jobs.assignedSubtitle", {
              date: job.assigned_at ? date(job.assigned_at) : "",
            })}
          </Typography.Paragraph>
        </div>

        {job.state === "published" && (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => setSuggestModalOpen(true)}
          >
            {t("marketplace.jobs.suggestToContact")}
          </Button>
        )}
      </Flex>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Card>
            <Tabs defaultActiveKey="opening" items={tabItems} />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Card
              title={t("marketplace.jobs.owner.cardTitle")}
              extra={
                <Button
                  size="small"
                  onClick={() => setOwnerModalOpen(true)}
                  disabled={me === undefined}
                >
                  {t("marketplace.jobs.owner.change")}
                </Button>
              }
            >
              <Flex vertical gap={4}>
                <Flex align="center" gap="small">
                  <UserOutlined aria-hidden />
                  <Typography.Text strong data-testid="job-owner">
                    {job.owner === undefined
                      ? t("marketplace.jobs.owner.none")
                      : job.owner === me?.email_address
                        ? t("marketplace.jobs.owner.you", { owner: job.owner })
                        : job.owner}
                  </Typography.Text>
                </Flex>
                <Typography.Text type="secondary">
                  {t("marketplace.jobs.owner.privacy")}
                </Typography.Text>
              </Flex>
            </Card>
            <Card title={t("marketplace.jobs.yourWorkTitle")}>
              <Row gutter={16}>
                <Col span={12}>
                  <Statistic
                    title={t("marketplace.jobs.statSuggested")}
                    value={suggestedContacts.length}
                    suffix={t("marketplace.jobs.statContactsSuffix")}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title={t("marketplace.jobs.statCredited")}
                    value={creditedApps.length}
                    suffix={t("marketplace.jobs.statApplicationsSuffix")}
                  />
                </Col>
              </Row>
            </Card>

            <Card title={t("marketplace.jobs.creditedTitle")}>
              {creditedApps.length === 0 ? (
                <Typography.Text type="secondary">
                  {t("marketplace.jobs.noCreditedApplicationsYet")}
                </Typography.Text>
              ) : (
                <Flex vertical gap="middle">
                  {creditedApps.map((app) => (
                    <Flex
                      key={app.application_number}
                      justify="space-between"
                      align="center"
                    >
                      <div>
                        <Typography.Text strong style={{ display: "block" }}>
                          #{app.application_number}
                        </Typography.Text>
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          {app.applied_at ? date(app.applied_at) : ""}
                        </Typography.Text>
                      </div>
                      <Space>
                        <Tag
                          color={referralRouteColors[app.route] ?? "default"}
                        >
                          {referralRouteLabel(t, app.route)}
                        </Tag>
                        <Tag color={hubStatusColors[app.status] ?? "default"}>
                          {hubStatusLabel(t, app.status)}
                        </Tag>
                      </Space>
                    </Flex>
                  ))}
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, marginTop: 8 }}
                  >
                    {t("marketplace.jobs.creditedApplicationsPrivacyNotice")}
                  </Typography.Text>
                </Flex>
              )}
            </Card>
          </Space>
        </Col>
      </Row>

      {me !== undefined && ownerModalOpen ? (
        <JobOwnerModal
          job={job}
          myEmail={me.email_address}
          open={ownerModalOpen}
          onClose={() => setOwnerModalOpen(false)}
        />
      ) : null}
      <SuggestToContactModal
        open={suggestModalOpen}
        onClose={() => setSuggestModalOpen(false)}
        job={job}
        jobContent={content}
        alreadySuggestedContactIds={alreadySuggestedContactIds}
        onSuccess={() => void jobQuery.refetch()}
      />
    </Space>
  );
}
