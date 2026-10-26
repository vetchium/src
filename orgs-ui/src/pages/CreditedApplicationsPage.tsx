import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Avatar,
  Card,
  Col,
  Flex,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ApplicationStatus } from "typespec/hub/applications/applications";
import type {
  CreditedApplicationSummary,
  ReferralRoute,
} from "typespec/orgs/marketplace/attribution";
import { paths } from "../app/paths";
import {
  getInitials,
  hubStatusColors,
  hubStatusLabel,
  referralRouteColors,
  referralRouteLabel,
} from "../features/marketplace/presentation";
import {
  useContactsQuery,
  useCreditedApplicationsQuery,
} from "../features/marketplace/queries";
import { ClientPicker } from "../features/marketplace/SuggestionSelect";

const routes: ReferralRoute[] = ["suggested", "declared"];
const statuses: ApplicationStatus[] = [
  "applied",
  "in_review",
  "interviewing",
  "offer",
  "hired",
  "not_progressing",
  "withdrawn",
];

export function CreditedApplicationsPage() {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();

  const [selectedClient, setSelectedClient] = useState<string>();
  const [selectedOpening, setSelectedOpening] = useState<number>();
  const [selectedRoute, setSelectedRoute] = useState<ReferralRoute>();
  const [selectedStatus, setSelectedStatus] = useState<ApplicationStatus>();

  const attributionQuery = useCreditedApplicationsQuery({
    ...(selectedClient && { client_domain: selectedClient }),
    ...(selectedOpening !== undefined && { opening_number: selectedOpening }),
    ...(selectedRoute && { route: selectedRoute }),
    ...(selectedStatus && { status: selectedStatus }),
  });

  const contactsQuery = useContactsQuery();
  const contacts = contactsQuery.data?.items ?? [];

  const contactMap = useMemo(() => {
    const map = new Map<string, { name: string; handle: string }>();
    for (const c of contacts) {
      map.set(c.contact_id, { name: c.display_name, handle: c.handle });
    }
    return map;
  }, [contacts]);

  const items = attributionQuery.data?.items ?? [];
  const unavailableTenants = attributionQuery.data?.unavailable_tenants ?? [];

  // Summary counts across loaded items
  const totalCredited = items.length;
  const inProgressCount = items.filter(
    (i) =>
      i.status === "applied" ||
      i.status === "in_review" ||
      i.status === "interviewing" ||
      i.status === "offer",
  ).length;
  const hiredCount = items.filter((i) => i.status === "hired").length;

  const openingOptions = useMemo(() => {
    const ops = new Map<number, string>();
    for (const item of items) {
      if (item.opening?.number) {
        ops.set(
          item.opening.number,
          `#${item.opening.number} ${item.opening.title}`,
        );
      }
    }
    return Array.from(ops.entries()).map(([value, label]) => ({
      value,
      label,
    }));
  }, [items]);

  const columns: ColumnsType<CreditedApplicationSummary> = [
    {
      title: t("marketplace.attribution.tableApplicant"),
      key: "applicant",
      render: (_, item) => {
        const contactInfo = item.contact_id
          ? contactMap.get(item.contact_id)
          : undefined;
        const displayName =
          contactInfo?.name ?? `Applicant #${item.application_number}`;
        const country = item.opening?.employing_country
          ? t(`countries.${item.opening.employing_country}`, {
              defaultValue: item.opening.employing_country,
            })
          : "";

        return (
          <Flex align="center" gap="middle">
            <Avatar size="small" style={{ backgroundColor: "#1677ff" }}>
              {getInitials(displayName)}
            </Avatar>
            <div>
              {item.contact_id ? (
                <Link
                  to={paths.contactDetail(item.contact_id)}
                  style={{ fontWeight: 500 }}
                >
                  {displayName}
                </Link>
              ) : (
                <Typography.Text strong>{displayName}</Typography.Text>
              )}
              {country && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {country}
                  </Typography.Text>
                </div>
              )}
            </div>
          </Flex>
        );
      },
    },
    {
      title: t("marketplace.attribution.tableClient"),
      key: "client",
      render: (_, item) => item.client.display_name || item.client.domain,
    },
    {
      title: t("marketplace.attribution.tableOpening"),
      key: "opening",
      render: (_, item) => `#${item.opening.number} ${item.opening.title}`,
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

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 4 }}>
          {t("marketplace.attribution.title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("marketplace.attribution.subtitle")}
        </Typography.Paragraph>
      </div>

      {unavailableTenants.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t("marketplace.attribution.unavailableNotice", {
            count: unavailableTenants.length,
          })}
        />
      )}

      {/* Stat cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title={t("marketplace.attribution.statCredited")}
              value={totalCredited}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title={t("marketplace.attribution.statInProgress")}
              value={inProgressCount}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title={t("marketplace.attribution.statHired")}
              value={hiredCount}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        <Flex vertical gap="middle">
          {/* Filters row */}
          <Flex gap="middle" wrap>
            <ClientPicker
              capability="sourcing"
              value={selectedClient}
              onChange={setSelectedClient}
              placeholder={t("marketplace.attribution.filterClient")}
              ariaLabel={t("marketplace.attribution.filterClient")}
              notFound={t("marketplace.jobs.noClientFound")}
            />
            <Select
              allowClear
              placeholder={t("marketplace.attribution.filterOpening")}
              value={selectedOpening}
              onChange={setSelectedOpening}
              options={openingOptions}
              style={{ minWidth: 200 }}
            />
            <Select
              allowClear
              placeholder={t("marketplace.attribution.filterRoute")}
              value={selectedRoute}
              onChange={setSelectedRoute}
              options={routes.map((r) => ({
                value: r,
                label: referralRouteLabel(t, r),
              }))}
              style={{ minWidth: 140 }}
            />
            <Select
              allowClear
              placeholder={t("marketplace.attribution.filterStatus")}
              value={selectedStatus}
              onChange={setSelectedStatus}
              options={statuses.map((s) => ({
                value: s,
                label: hubStatusLabel(t, s),
              }))}
              style={{ minWidth: 160 }}
            />
          </Flex>

          <Table<CreditedApplicationSummary>
            rowKey={(item) =>
              `${item.engagement_id}-${item.application_number}`
            }
            columns={columns}
            dataSource={items}
            loading={attributionQuery.isLoading}
            pagination={{ pageSize: 25 }}
          />
        </Flex>
      </Card>
    </Space>
  );
}
