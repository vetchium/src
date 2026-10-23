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
  useAcceptEngagementMutation,
  useClientEngagementQuery,
  useClientEngagementStatementQuery,
  useDeclineEngagementMutation,
  useEndClientEngagementMutation,
  useSetClientEngagementReferenceMutation,
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

export function ClientEngagementDetailPage() {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const { message: toast } = App.useApp();
  const { id } = useParams<{ id: string }>();

  const validId = id && isEngagementID(id) ? id : undefined;

  const engagementQuery = useClientEngagementQuery(validId);
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

  const statementQuery = useClientEngagementStatementQuery(
    {
      engagement_id: validId ?? "",
      month: selectedMonth,
      ...(currentStatementKey && { pagination_key: currentStatementKey }),
      limit: 25,
    },
    validId !== undefined,
  );

  // Reference edit
  const [editingRef, setEditingRef] = useState(false);
  const [customRef, setCustomRef] = useState("");
  const setRefMutation = useSetClientEngagementReferenceMutation();
  const setRefKey = useIdempotencyKey("set-client-engagement-ref");

  // Accept & Decline
  const acceptMutation = useAcceptEngagementMutation();
  const declineMutation = useDeclineEngagementMutation();
  const acceptKey = useIdempotencyKey("accept-engagement");
  const declineKey = useIdempotencyKey("decline-engagement");
  const [declineOpen, setDeclineOpen] = useState(false);

  // End modal
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [endNote, setEndNote] = useState("");
  const endMutation = useEndClientEngagementMutation();
  const endKey = useIdempotencyKey("end-client-engagement");

  // CSV export state
  const [exporting, setExporting] = useState(false);

  const handleSaveReference = async () => {
    if (!engagement) return;
    try {
      await setRefMutation.mutateAsync({
        request: {
          engagement_id: engagement.id,
          version: engagement.version,
          reference: customRef.trim() || undefined,
        },
        key: setRefKey.current(),
      });
      setRefKey.rotate();
      setEditingRef(false);
      void toast.success(t("marketplace.references.saveSuccess"));
    } catch {
      void toast.error(t("marketplace.references.saveError"));
    }
  };

  const handleAccept = async () => {
    if (!engagement) return;
    try {
      await acceptMutation.mutateAsync({
        request: {
          engagement_id: engagement.id,
          version: engagement.version,
        },
        key: acceptKey.current(),
      });
      acceptKey.rotate();
      void toast.success(t("marketplace.clients.acceptSuccess"));
    } catch {
      void toast.error(t("marketplace.clients.acceptError"));
    }
  };

  const handleDecline = async () => {
    if (!engagement) return;
    try {
      await declineMutation.mutateAsync({
        request: {
          engagement_id: engagement.id,
          version: engagement.version,
        },
        key: declineKey.current(),
      });
      declineKey.rotate();
      setDeclineOpen(false);
      void toast.success(t("marketplace.clients.declineSuccess"));
    } catch {
      void toast.error(t("marketplace.clients.declineError"));
    }
  };

  const handleEndEngagement = async () => {
    if (!engagement) return;
    try {
      await endMutation.mutateAsync({
        request: {
          engagement_id: engagement.id,
          version: engagement.version,
          note: endNote.trim() || undefined,
        },
        key: endKey.current(),
      });
      endKey.rotate();
      setEndModalOpen(false);
      setEndNote("");
      void toast.success(t("marketplace.endEngagement.success"));
    } catch {
      void toast.error(t("marketplace.endEngagement.error"));
    }
  };

  const handleExportCSV = async () => {
    if (!validId) return;
    setExporting(true);
    try {
      const allItems: ActivityStatementItem[] = [];
      let cursor: PaginationKey | undefined;

      while (true) {
        const resp = await orgsAPI.getClientEngagementStatement({
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
        "Event time (UTC)",
        "Item ID",
        "Fact",
        "Opening #",
        "Opening title",
        "Application #",
        "Applicant name",
        "Corrected",
      ];

      const csvRows = [headers.map(escapeCSV).join(",")];
      for (const item of allItems) {
        csvRows.push(
          [
            item.date,
            item.fact_id,
            item.fact,
            String(item.opening_number),
            item.opening_title,
            String(item.application_number),
            item.applicant_display_name ?? "",
            item.corrected ? "true" : "false",
          ]
            .map(escapeCSV)
            .join(","),
        );
      }

      const blob = new Blob([csvRows.join("\r\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `statement-${validId}-${selectedMonth}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
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
      dataIndex: "recorded_at",
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
        <Typography.Text>
          #{r.opening_number} {r.opening_title}
        </Typography.Text>
      ),
    },
    {
      title: t("marketplace.statement.application"),
      key: "application",
      render: (_, r) => (
        <Typography.Text>#{r.application_number}</Typography.Text>
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
      title: t("marketplace.statement.corrected"),
      dataIndex: "corrected",
      render: (v) =>
        v ? (
          <Tag color="warning">{t("marketplace.statement.correctedTag")}</Tag>
        ) : null,
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.clients}>{t("marketplace.clients.title")}</Link>
            ),
          },
          { title: engagement.counterparty.display_name },
        ]}
      />

      <Flex justify="space-between" align="center" wrap gap="middle">
        <div>
          <Flex gap="small" align="center">
            <Typography.Title level={2} style={{ marginBottom: 0 }}>
              {engagement.counterparty.display_name}
            </Typography.Title>
            <Tag color={capabilityColors[engagement.capability]}>
              {capabilityLabel(t, engagement.capability)}
            </Tag>
            <Tag color={engagementStateColors[engagement.state]}>
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
          <Flex gap="small">
            <Button
              type="primary"
              loading={acceptMutation.isPending}
              onClick={() => void handleAccept()}
            >
              {t("common.accept")}
            </Button>
            <Button onClick={() => setDeclineOpen(true)}>
              {t("common.decline")}
            </Button>
          </Flex>
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
                        {engagement.provider_reference || "—"}
                      </Typography.Text>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setCustomRef(engagement.provider_reference || "");
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
                    {engagement.consumer_reference || "—"}
                  </Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title={t("marketplace.proposal.title")}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label={t("marketplace.proposal.proposedOn")}>
                  {date(engagement.proposed_at)}
                </Descriptions.Item>
                {engagement.expires_at && (
                  <Descriptions.Item
                    label={t("marketplace.proposal.expiresOn")}
                  >
                    {date(engagement.expires_at)}
                  </Descriptions.Item>
                )}
                {engagement.decided_at && (
                  <Descriptions.Item
                    label={t("marketplace.proposal.decidedOn")}
                  >
                    {date(engagement.decided_at)}
                  </Descriptions.Item>
                )}
              </Descriptions>

              {engagement.message ? (
                <div style={{ marginTop: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t("marketplace.proposal.message")}:
                  </Typography.Text>
                  <Card
                    size="small"
                    style={{
                      marginTop: 4,
                      backgroundColor:
                        "var(--ant-color-bg-container-disabled, #f9fafb)",
                    }}
                  >
                    <Typography.Paragraph
                      style={{ marginBottom: 0, fontStyle: "italic" }}
                    >
                      “{engagement.message}”
                    </Typography.Paragraph>
                  </Card>
                </div>
              ) : null}
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
                    setSelectedMonth(val);
                    setStatementCursorStack([]);
                  }}
                  style={{ width: 130 }}
                  options={recentMonths.map((m) => ({ value: m, label: m }))}
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
        title={t("marketplace.clients.declineModalTitle")}
        open={declineOpen}
        onCancel={() => setDeclineOpen(false)}
        onOk={() => void handleDecline()}
        okText={t("common.decline")}
        okButtonProps={{ danger: true, loading: declineMutation.isPending }}
      >
        <Typography.Paragraph>
          {t("marketplace.clients.declineModalText", {
            client: engagement.counterparty.display_name,
          })}
        </Typography.Paragraph>
      </Modal>
    </Space>
  );
}
