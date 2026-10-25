import { CalendarOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Avatar,
  Button,
  Card,
  Col,
  Flex,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { PaginationKey } from "typespec/common/pagination";
import {
  type Capability,
  capabilityValues,
} from "typespec/orgs/marketplace/capabilities";
import {
  type WorkItem,
  type WorkStatus,
  workStatusValues,
} from "typespec/orgs/marketplace/work/work";
import { paths } from "../app/paths";
import {
  capabilityColors,
  capabilityLabel,
  workStatusColors,
  workStatusLabel,
} from "../features/marketplace/presentation";
import { useWorkQueueQuery } from "../features/marketplace/queries";
import { ClientPicker } from "../features/marketplace/SuggestionSelect";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts[parts.length - 1]?.charAt(0) ?? "";
  if (parts.length === 0) return "C";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "C";
  return (first + last).toUpperCase();
}

export function WorkQueuePage() {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const navigate = useNavigate();

  // Filters
  const [capability, setCapability] = useState<Capability>();
  const [status, setStatus] = useState<WorkStatus>();
  const [clientDomain, setClientDomain] = useState<string>();
  const [stageName, setStageName] = useState("");

  const [cursorStack, setCursorStack] = useState<PaginationKey[]>([]);
  const currentKey = cursorStack[cursorStack.length - 1];

  const workQueueQuery = useWorkQueueQuery({
    ...(capability && { capability }),
    ...(status && { status }),
    ...(clientDomain !== undefined && { client_domain: clientDomain }),
    ...(stageName.trim() && { stage_name: stageName.trim() }),
    ...(currentKey && { pagination_key: currentKey }),
    limit: 25,
  });

  const items = workQueueQuery.data?.items ?? [];

  // Summary counts from items
  const scheduledCount = items.filter((i) => i.status === "scheduled").length;
  const pendingCount = items.filter((i) => i.status === "pending").length;
  const inProgressCount = items.filter(
    (i) => i.status === "in_progress" || i.status === "awaiting_consent",
  ).length;

  const columns: ColumnsType<WorkItem> = [
    {
      title: t("marketplace.workQueue.columns.when"),
      key: "when",
      render: (_, r) =>
        r.next_interview_at ? (
          date(r.next_interview_at)
        ) : (
          <Typography.Text type="secondary">
            {t("marketplace.workQueue.notScheduled")}
          </Typography.Text>
        ),
    },
    {
      title: t("marketplace.workQueue.columns.candidate"),
      key: "candidate",
      render: (_, r) => (
        <Flex gap="small" align="center">
          <Avatar size="small" style={{ backgroundColor: "#2563eb" }}>
            {getInitials(r.applicant_name)}
          </Avatar>
          <Typography.Text strong>{r.applicant_name}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("marketplace.workQueue.columns.client"),
      key: "client",
      render: (_, r) => (
        <Flex vertical>
          <Typography.Text strong>{r.client.display_name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.client.domain}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("marketplace.workQueue.columns.openingAndStage"),
      key: "openingStage",
      render: (_, r) => (
        <Flex vertical>
          <Typography.Text>
            #{r.opening.number} {r.opening.title}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.stage_name}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("marketplace.columns.capability"),
      dataIndex: "capability",
      render: (v) => (
        <Tag color={capabilityColors[v as Capability]}>
          {capabilityLabel(t, v)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.columns.state"),
      dataIndex: "status",
      render: (v) => (
        <Tag color={workStatusColors[v as WorkStatus]}>
          {workStatusLabel(t, v)}
        </Tag>
      ),
    },
    {
      title: "",
      key: "actions",
      align: "end",
      render: (_, r) => (
        <Button
          type="link"
          onClick={() => navigate(paths.workItem(r.engagement_id, r.work_id))}
        >
          {t("common.view")}
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 4 }}>
          {t("marketplace.workQueue.title")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("marketplace.workQueue.intro")}
        </Typography.Text>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t("marketplace.workQueue.stats.scheduled")}
              value={scheduledCount}
              prefix={<CalendarOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t("marketplace.workQueue.stats.pending")}
              value={pendingCount}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t("marketplace.workQueue.stats.inProgress")}
              value={inProgressCount}
              styles={{ content: { color: "#d97706" } }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t("marketplace.workQueue.stats.total")}
              value={items.length}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        <Flex gap="small" wrap style={{ marginBottom: 16 }}>
          <Select
            style={{ width: 170 }}
            placeholder={t("marketplace.filters.capability")}
            allowClear
            value={capability}
            onChange={(val) => {
              setCapability(val);
              setCursorStack([]);
            }}
            options={capabilityValues.map((c) => ({
              value: c,
              label: capabilityLabel(t, c),
            }))}
          />

          <Select
            style={{ width: 170 }}
            placeholder={t("marketplace.workQueue.statusPlaceholder")}
            allowClear
            value={status}
            onChange={(val) => {
              setStatus(val);
              setCursorStack([]);
            }}
            options={workStatusValues.map((s) => ({
              value: s,
              label: workStatusLabel(t, s),
            }))}
          />

          <ClientPicker
            value={clientDomain}
            onChange={(domain) => {
              setClientDomain(domain);
              setCursorStack([]);
            }}
            placeholder={t("marketplace.workQueue.clientPlaceholder")}
            ariaLabel={t("marketplace.workQueue.clientPlaceholder")}
            notFound={t("marketplace.jobs.noClientFound")}
          />

          <Input
            style={{ width: 200 }}
            placeholder={t("marketplace.workQueue.stageNamePlaceholder")}
            allowClear
            value={stageName}
            onChange={(e) => {
              setStageName(e.target.value);
              setCursorStack([]);
            }}
          />
        </Flex>

        <Table<WorkItem>
          rowKey={(r) => r.work_id}
          loading={workQueueQuery.isLoading}
          dataSource={items}
          columns={columns}
          pagination={false}
        />

        <Flex justify="end" gap="small" style={{ marginTop: 16 }}>
          <Button
            disabled={cursorStack.length === 0}
            onClick={() => setCursorStack((prev) => prev.slice(0, -1))}
          >
            {t("common.previous")}
          </Button>
          <Button
            disabled={!workQueueQuery.data?.next_pagination_key}
            onClick={() => {
              const nextKey = workQueueQuery.data?.next_pagination_key;
              if (nextKey) {
                setCursorStack((prev) => [...prev, nextKey]);
              }
            }}
          >
            {t("common.next")}
          </Button>
        </Flex>
      </Card>
    </Space>
  );
}
