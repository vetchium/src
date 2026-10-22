import { DownloadOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { PaginationKey } from "typespec/common/pagination";
import { isEngagementID } from "typespec/orgs/marketplace/engagements";
import type { ActivityStatementItem } from "typespec/orgs/marketplace/statements";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";
import {
  capabilityColors,
  capabilityLabel,
  engagementStateColors,
  engagementStateLabel,
  factColors,
  factLabel,
} from "../features/marketplace/presentation";
import {
  useConsumerEngagementQuery,
  useEndEngagementMutation,
  useEngagementStatementQuery,
  useSetEngagementReferenceMutation,
  useWithdrawEngagementMutation,
} from "../features/marketplace/queries";

function generateRecentMonths(): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
    );
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    result.push(`${year}-${month}`);
  }
  return result;
}

function escapeCSV(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function EngagementDetailPage() {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const { message: toast } = App.useApp();
  const { id } = useParams<{ id: string }>();

  const validId = id && isEngagementID(id) ? id : undefined;

  const engagementQuery = useConsumerEngagementQuery(validId);
  const engagement = engagementQuery.data;

  // Month selection for statement
  const recentMonths = useMemo(() => generateRecentMonths(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(
    recentMonths[0] ?? "",
  );
  const [statementCursorStack, setStatementCursorStack] = useState<
    PaginationKey[]
  >([]);
  const currentStatementKey =
    statementCursorStack[statementCursorStack.length - 1];

  const statementQuery = useEngagementStatementQuery(
    {
      engagement_id: validId ?? "",
      month: selectedMonth,
      ...(currentStatementKey && { pagination_key: currentStatementKey }),
      limit: 25,
    },
    validId !== undefined,
  );

  // Reference editing state
  const [editingRef, setEditingRef] = useState(false);
  const [customRef, setCustomRef] = useState("");
  const setRefMutation = useSetEngagementReferenceMutation();
  const refKey = useIdempotencyKey("set-ref");

  // End engagement modal state
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [endNote, setEndNote] = useState("");
  const endMutation = useEndEngagementMutation();
  const endKey = useIdempotencyKey("end-engagement");

  // Withdraw proposal modal state
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const withdrawMutation = useWithdrawEngagementMutation();
  const withdrawKey = useIdempotencyKey("withdraw-engagement");

  // CSV Export state
  const [exporting, setExporting] = useState(false);

  const formatMonthLabel = (monthStr: string) => {
    const [year, month] = monthStr.split("-");
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return new Intl.DateTimeFormat([i18n.language], {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }).format(d);
  };

  const handleSaveReference = async () => {
    if (!engagement) return;
    try {
      await setRefMutation.mutateAsync({
        request: {
          engagement_id: engagement.id,
          version: engagement.version,
          reference: customRef.trim() || undefined,
        },
        key: refKey.current(),
      });
      refKey.rotate();
      void toast.success(t("marketplace.referenceSaved"));
      setEditingRef(false);
      void engagementQuery.refetch();
    } catch {
      void toast.error(t("marketplace.referenceSaveError"));
    }
  };

  const handleEndEngagement = async () => {
    if (!engagement) return;
    try {
      await endMutation.mutateAsync({
        request: {
          engagement_id: engagement.id,
          version: engagement.version,
          ...(endNote.trim() && { note: endNote.trim() }),
        },
        key: endKey.current(),
      });
      endKey.rotate();
      void toast.success(t("marketplace.endEngagement.success"));
      setEndModalOpen(false);
      void engagementQuery.refetch();
    } catch {
      void toast.error(t("marketplace.endEngagement.error"));
    }
  };

  const handleWithdrawEngagement = async () => {
    if (!engagement) return;
    try {
      await withdrawMutation.mutateAsync({
        request: {
          engagement_id: engagement.id,
          version: engagement.version,
        },
        key: withdrawKey.current(),
      });
      withdrawKey.rotate();
      void toast.success(t("marketplace.withdrawEngagement.success"));
      setWithdrawModalOpen(false);
      void engagementQuery.refetch();
    } catch {
      void toast.error(t("marketplace.withdrawEngagement.error"));
    }
  };

  const handleExportCSV = async () => {
    if (!validId) return;
    setExporting(true);
    try {
      const allItems: ActivityStatementItem[] = [];
      let cursor: PaginationKey | undefined;

      while (true) {
        const resp = await orgsAPI.getEngagementStatement({
          engagement_id: validId,
          month: selectedMonth,
          ...(cursor && { pagination_key: cursor }),
          limit: 100,
        });
        allItems.push(...resp.items);
        if (!resp.next_pagination_key) break;
        cursor = resp.next_pagination_key;
      }

      const headers = [
        t("marketplace.statement.date"),
        t("marketplace.statement.fact"),
        t("marketplace.statement.opening"),
        t("marketplace.statement.application"),
        t("marketplace.statement.applicant"),
        t("marketplace.statement.corrected"),
      ];

      const rows = allItems.map((item) => [
        escapeCSV(item.date),
        escapeCSV(factLabel(t, item.fact)),
        escapeCSV(`#${item.opening_number} ${item.opening_title}`),
        escapeCSV(`#${item.application_number}`),
        escapeCSV(
          item.applicant_display_name ||
            t("marketplace.statement.removedApplicant"),
        ),
        escapeCSV(item.corrected ? t("common.yes") : t("common.no")),
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((r) => r.join(",")),
      ].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `statement-${engagement?.counterparty.domain ?? "engagement"}-${selectedMonth}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      void toast.success(t("marketplace.statement.exported"));
    } catch {
      void toast.error(t("marketplace.statement.exportError"));
    } finally {
      setExporting(false);
    }
  };

  if (!validId) {
    return (
      <Alert
        type="error"
        showIcon
        title={t("marketplace.invalidEngagementId")}
      />
    );
  }

  if (engagementQuery.isLoading) {
    return <Card loading />;
  }

  if (engagementQuery.isError || !engagement) {
    return (
      <Alert
        type="error"
        showIcon
        title={t("marketplace.engagementNotFound")}
      />
    );
  }

  const statementColumns: ColumnsType<ActivityStatementItem> = [
    {
      title: t("marketplace.statement.date"),
      dataIndex: "date",
      render: (v) => date(v),
    },
    {
      title: t("marketplace.statement.fact"),
      dataIndex: "fact",
      render: (v) => (
        <Tag color={factColors[v as keyof typeof factColors]}>
          {factLabel(t, v)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.statement.opening"),
      key: "opening",
      render: (_, r) => (
        <Link to={paths.openingDetail(r.opening_number)}>
          #{r.opening_number} {r.opening_title}
        </Link>
      ),
    },
    {
      title: t("marketplace.statement.application"),
      key: "application",
      render: (_, r) => (
        <Link to={paths.application(r.opening_number, r.application_number)}>
          #{r.application_number}
        </Link>
      ),
    },
    {
      title: t("marketplace.statement.applicant"),
      dataIndex: "applicant_display_name",
      render: (v) =>
        v ? (
          v
        ) : (
          <Typography.Text type="secondary" italic>
            {t("marketplace.statement.removedApplicant")}
          </Typography.Text>
        ),
    },
    {
      title: "",
      dataIndex: "corrected",
      render: (v) =>
        v ? (
          <Tooltip title={t("marketplace.statement.correctedTooltip")}>
            <Tag color="warning">{t("marketplace.statement.corrected")}</Tag>
          </Tooltip>
        ) : null,
    },
  ];

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.findProviders}>
                {t("marketplace.findProviders.title")}
              </Link>
            ),
          },
          {
            title: (
              <Link to={`${paths.findProviders}?tab=engagements`}>
                {t("marketplace.findProviders.tabs.engagements")}
              </Link>
            ),
          },
          { title: engagement.counterparty.display_name },
        ]}
      />

      <Flex justify="space-between" align="start" wrap gap="middle">
        <div>
          <Flex gap="middle" align="center" wrap>
            <Typography.Title level={1} style={{ marginBottom: 0 }}>
              {engagement.counterparty.display_name}
            </Typography.Title>
            <Tag
              color={capabilityColors[engagement.capability]}
              style={{ fontSize: 14 }}
            >
              {capabilityLabel(t, engagement.capability)}
            </Tag>
            <Tag
              color={engagementStateColors[engagement.state]}
              style={{ fontSize: 14 }}
            >
              {engagementStateLabel(t, engagement.state)}
            </Tag>
          </Flex>
          <Typography.Text
            type="secondary"
            style={{ marginTop: 4, display: "block" }}
          >
            {engagement.counterparty.domain} ·{" "}
            {engagement.decided_at
              ? t("marketplace.activeSince", {
                  date: date(engagement.decided_at),
                })
              : t("marketplace.proposedAt", {
                  date: date(engagement.proposed_at),
                })}
          </Typography.Text>
        </div>

        {engagement.state === "active" && (
          <Button danger onClick={() => setEndModalOpen(true)}>
            {t("marketplace.endEngagement.action")}
          </Button>
        )}
        {engagement.state === "proposed" && (
          <Button onClick={() => setWithdrawModalOpen(true)}>
            {t("marketplace.withdrawEngagement.action")}
          </Button>
        )}
      </Flex>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Flex vertical gap="middle">
            <Card title={t("marketplace.references.title")}>
              <Typography.Paragraph type="secondary">
                {t("marketplace.references.intro")}
              </Typography.Paragraph>

              <Descriptions column={1} size="small">
                <Descriptions.Item label={t("marketplace.references.yours")}>
                  {editingRef ? (
                    <Flex
                      gap="small"
                      vertical
                      style={{ width: "100%", marginTop: 4 }}
                    >
                      <Input
                        maxLength={200}
                        value={customRef}
                        placeholder="PO-2026-…"
                        onChange={(e) => setCustomRef(e.target.value)}
                      />
                      <Flex gap="small">
                        <Button
                          size="small"
                          type="primary"
                          loading={setRefMutation.isPending}
                          onClick={() => void handleSaveReference()}
                        >
                          {t("common.save")}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => setEditingRef(false)}
                        >
                          {t("common.cancel")}
                        </Button>
                      </Flex>
                    </Flex>
                  ) : (
                    <Flex gap="small" align="center">
                      <Typography.Text strong>
                        {engagement.consumer_reference || "—"}
                      </Typography.Text>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setCustomRef(engagement.consumer_reference || "");
                          setEditingRef(true);
                        }}
                      >
                        {t("common.edit")}
                      </Button>
                    </Flex>
                  )}
                </Descriptions.Item>
                <Descriptions.Item
                  label={t("marketplace.references.theirs", {
                    name: engagement.counterparty.display_name,
                  })}
                >
                  <Typography.Text>
                    {engagement.provider_reference || "—"}
                  </Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card
              title={
                engagement.capability === "sourcing"
                  ? t("marketplace.assignedOpenings")
                  : t("marketplace.assignedStages")
              }
            >
              <Typography.Paragraph type="secondary">
                {engagement.capability === "sourcing"
                  ? t("marketplace.assignedOpeningsIntro")
                  : t("marketplace.assignedStagesIntro")}
              </Typography.Paragraph>
              <Link to={paths.openings}>
                {t("marketplace.manageInOpenings")}
              </Link>
            </Card>

            <Card title={t("marketplace.proposal.title")}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label={t("marketplace.proposal.proposed")}>
                  {date(engagement.proposed_at)}
                </Descriptions.Item>
                {engagement.decided_at && (
                  <Descriptions.Item label={t("marketplace.proposal.accepted")}>
                    {date(engagement.decided_at)}
                  </Descriptions.Item>
                )}
                {engagement.message && (
                  <Descriptions.Item label={t("marketplace.proposal.message")}>
                    <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                      {engagement.message}
                    </Typography.Text>
                  </Descriptions.Item>
                )}
                {engagement.ended_at && (
                  <>
                    <Descriptions.Item label={t("marketplace.proposal.ended")}>
                      {date(engagement.ended_at)}
                    </Descriptions.Item>
                    {engagement.ended_by && (
                      <Descriptions.Item
                        label={t("marketplace.proposal.endedBy")}
                      >
                        {engagement.ended_by === "consumer"
                          ? t("marketplace.proposal.endedByYou")
                          : engagement.counterparty.display_name}
                      </Descriptions.Item>
                    )}
                    {engagement.end_note && (
                      <Descriptions.Item
                        label={t("marketplace.proposal.endNote")}
                      >
                        <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                          {engagement.end_note}
                        </Typography.Text>
                      </Descriptions.Item>
                    )}
                  </>
                )}
              </Descriptions>
            </Card>
          </Flex>
        </Col>

        <Col xs={24} lg={16}>
          <Card
            title={t("marketplace.statement.title")}
            extra={
              <Flex gap="small" align="center">
                <Select
                  value={selectedMonth}
                  onChange={(val) => {
                    setStatementCursorStack([]);
                    setSelectedMonth(val);
                  }}
                  style={{ width: 180 }}
                  options={recentMonths.map((m) => ({
                    value: m,
                    label: formatMonthLabel(m),
                  }))}
                />
                <Button
                  icon={<DownloadOutlined />}
                  loading={exporting}
                  onClick={() => void handleExportCSV()}
                >
                  {t("marketplace.statement.exportCSV")}
                </Button>
              </Flex>
            }
          >
            <Typography.Paragraph type="secondary">
              {t("marketplace.statement.intro", {
                provider: engagement.counterparty.display_name,
              })}
            </Typography.Paragraph>

            <Table<ActivityStatementItem>
              rowKey="fact_id"
              size="small"
              loading={statementQuery.isLoading}
              pagination={false}
              dataSource={statementQuery.data?.items}
              columns={statementColumns}
            />

            <Flex justify="end" gap="small" style={{ marginTop: 16 }}>
              <Button
                disabled={statementCursorStack.length === 0}
                onClick={() =>
                  setStatementCursorStack((prev) => prev.slice(0, -1))
                }
              >
                {t("common.previous")}
              </Button>
              <Button
                disabled={!statementQuery.data?.next_pagination_key}
                onClick={() => {
                  const nextKey = statementQuery.data?.next_pagination_key;
                  if (nextKey) {
                    setStatementCursorStack((prev) => [...prev, nextKey]);
                  }
                }}
              >
                {t("common.next")}
              </Button>
            </Flex>
          </Card>
        </Col>
      </Row>

      <Modal
        title={t("marketplace.endEngagement.title")}
        open={endModalOpen}
        onCancel={() => setEndModalOpen(false)}
        onOk={() => void handleEndEngagement()}
        okText={t("marketplace.endEngagement.confirm")}
        okButtonProps={{ danger: true, loading: endMutation.isPending }}
      >
        <Alert
          type="warning"
          showIcon
          message={t("marketplace.endEngagement.warning")}
          style={{ marginBottom: 16 }}
        />
        <Typography.Paragraph>
          {t("marketplace.endEngagement.noteHelp")}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={2000}
          value={endNote}
          onChange={(e) => setEndNote(e.target.value)}
          placeholder={t("marketplace.endEngagement.notePlaceholder")}
        />
      </Modal>

      <Modal
        title={t("marketplace.withdrawEngagement.title")}
        open={withdrawModalOpen}
        onCancel={() => setWithdrawModalOpen(false)}
        onOk={() => void handleWithdrawEngagement()}
        okText={t("marketplace.withdrawEngagement.confirm")}
        okButtonProps={{ loading: withdrawMutation.isPending }}
      >
        <Typography.Paragraph>
          {t("marketplace.withdrawEngagement.confirmText")}
        </Typography.Paragraph>
      </Modal>
    </Space>
  );
}
