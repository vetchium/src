import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  App,
  Avatar,
  Badge,
  Button,
  Card,
  Flex,
  Modal,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { PaginationKey } from "typespec/common/pagination";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type {
  Engagement,
  EngagementState,
} from "typespec/orgs/marketplace/engagements";
import { paths } from "../app/paths";
import {
  engagementStateColors,
  engagementStateLabel,
} from "../features/marketplace/presentation";
import {
  useAcceptEngagementMutation,
  useClientEngagementsQuery,
  useDeclineEngagementMutation,
} from "../features/marketplace/queries";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts[parts.length - 1]?.charAt(0) ?? "";
  if (parts.length === 0) return "C";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "C";
  return (first + last).toUpperCase();
}

/** One Capability's engagements as provider; its workspace names it. */
export function ClientsPage({ capability }: { capability: Capability }) {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const navigate = useNavigate();
  const { message: toast } = App.useApp();

  const [activeTab, setActiveTab] = useState<
    "all" | "active" | "ended" | "declined"
  >("active");

  const [cursorStack, setCursorStack] = useState<PaginationKey[]>([]);
  const currentKey = cursorStack[cursorStack.length - 1];

  const acceptMutation = useAcceptEngagementMutation();
  const declineMutation = useDeclineEngagementMutation();

  const acceptKey = useIdempotencyKey("accept-engagement");
  const declineKey = useIdempotencyKey("decline-engagement");

  const [declineTarget, setDeclineTarget] = useState<Engagement>();

  // Query pending proposals
  const pendingProposalsQuery = useClientEngagementsQuery({
    state: "proposed",
    capability,
    limit: 50,
  });

  // Query table engagements
  const engagementsQuery = useClientEngagementsQuery({
    ...(activeTab !== "all" && { state: activeTab as EngagementState }),
    capability,
    ...(currentKey && { pagination_key: currentKey }),
    limit: 25,
  });

  const pendingProposals = pendingProposalsQuery.data?.engagements ?? [];

  const handleAccept = async (e: Engagement) => {
    try {
      await acceptMutation.mutateAsync({
        request: { engagement_id: e.id, version: e.version },
        key: acceptKey.current(),
      });
      acceptKey.rotate();
      void toast.success(t("marketplace.clients.acceptSuccess"));
    } catch {
      void toast.error(t("marketplace.clients.acceptError"));
    }
  };

  const handleDecline = async () => {
    if (!declineTarget) return;
    try {
      await declineMutation.mutateAsync({
        request: {
          engagement_id: declineTarget.id,
          version: declineTarget.version,
        },
        key: declineKey.current(),
      });
      declineKey.rotate();
      setDeclineTarget(undefined);
      void toast.success(t("marketplace.clients.declineSuccess"));
    } catch {
      void toast.error(t("marketplace.clients.declineError"));
    }
  };

  const columns: ColumnsType<Engagement> = [
    {
      title: t("marketplace.columns.client"),
      key: "client",
      render: (_, r) => (
        <Flex gap="small" align="center">
          <Avatar size="small" style={{ backgroundColor: "#2563eb" }}>
            {getInitials(r.counterparty.display_name)}
          </Avatar>
          <Flex vertical>
            <Typography.Text strong>
              {r.counterparty.display_name}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.counterparty.domain}
            </Typography.Text>
          </Flex>
        </Flex>
      ),
    },
    {
      title: t("marketplace.columns.state"),
      dataIndex: "state",
      render: (v) => (
        <Tag color={engagementStateColors[v as EngagementState]}>
          {engagementStateLabel(t, v)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.columns.since"),
      key: "since",
      render: (_, r) =>
        r.decided_at
          ? date(r.decided_at)
          : r.proposed_at
            ? date(r.proposed_at)
            : "—",
    },
    {
      title: t("marketplace.columns.reference"),
      key: "ref",
      render: (_, r) => (
        <Flex vertical style={{ fontSize: 13 }}>
          <Typography.Text>{r.provider_reference || "—"}</Typography.Text>
          {r.consumer_reference && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {t("marketplace.clients.theirs")}: {r.consumer_reference}
            </Typography.Text>
          )}
        </Flex>
      ),
    },
    {
      title: "",
      key: "actions",
      align: "end",
      render: (_, r) => (
        <Button
          type="link"
          onClick={() =>
            navigate(paths.clientEngagementDetail(capability, r.id))
          }
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
          {t("marketplace.clients.title")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("marketplace.clients.intro")}
        </Typography.Text>
      </div>

      {pendingProposals.length > 0 && (
        <Card
          title={
            <Flex gap="small" align="center">
              <span>{t("marketplace.clients.awaitingDecision")}</span>
              <Badge count={pendingProposals.length} />
            </Flex>
          }
        >
          <Flex vertical gap="middle">
            {pendingProposals.map((item) => (
              <Card key={item.id} size="small">
                <Flex gap="middle" align="start" wrap justify="space-between">
                  <Flex
                    gap="middle"
                    align="start"
                    style={{ flex: 1, minWidth: 280 }}
                  >
                    <Avatar
                      size={48}
                      style={{ backgroundColor: "#2563eb", flexShrink: 0 }}
                    >
                      {getInitials(item.counterparty.display_name)}
                    </Avatar>
                    <Flex vertical gap={4} style={{ flex: 1 }}>
                      <Typography.Text strong style={{ fontSize: 16 }}>
                        {item.counterparty.display_name}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 13 }}
                      >
                        {item.counterparty.domain} ·{" "}
                        {t("marketplace.clients.proposedOn", {
                          date: date(item.proposed_at),
                        })}
                        {item.expires_at &&
                          ` · ${t("marketplace.clients.expiresOn", {
                            date: date(item.expires_at),
                          })}`}
                      </Typography.Text>

                      {item.message && (
                        <Card
                          size="small"
                          style={{
                            marginTop: 8,
                            backgroundColor:
                              "var(--ant-color-bg-container-disabled, #f9fafb)",
                          }}
                        >
                          <Typography.Paragraph
                            style={{ marginBottom: 0, fontStyle: "italic" }}
                          >
                            “{item.message}”
                          </Typography.Paragraph>
                        </Card>
                      )}

                      {item.consumer_reference && (
                        <Typography.Text
                          type="secondary"
                          style={{ marginTop: 4, fontSize: 12 }}
                        >
                          {t("marketplace.clients.theirs")}:{" "}
                          {item.consumer_reference}
                        </Typography.Text>
                      )}
                    </Flex>
                  </Flex>

                  <Flex gap="small">
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      loading={acceptMutation.isPending}
                      onClick={() => void handleAccept(item)}
                    >
                      {t("common.accept")}
                    </Button>
                    <Button
                      icon={<CloseOutlined />}
                      onClick={() => setDeclineTarget(item)}
                    >
                      {t("common.decline")}
                    </Button>
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
        </Card>
      )}

      <Card>
        <Flex
          justify="space-between"
          align="center"
          wrap
          gap="small"
          style={{ marginBottom: 16 }}
        >
          <Segmented
            value={activeTab}
            onChange={(val) => {
              setActiveTab(val as typeof activeTab);
              setCursorStack([]);
            }}
            options={[
              { value: "all", label: t("common.all") },
              {
                value: "active",
                label: t("marketplace.engagementStates.active"),
              },
              {
                value: "ended",
                label: t("marketplace.engagementStates.ended"),
              },
              {
                value: "declined",
                label: t("marketplace.engagementStates.declined"),
              },
            ]}
          />
        </Flex>

        <Table<Engagement>
          rowKey="id"
          loading={engagementsQuery.isLoading}
          dataSource={engagementsQuery.data?.engagements ?? []}
          columns={columns}
          pagination={false}
          scroll={{ x: "max-content" }}
        />

        <Flex justify="end" gap="small" style={{ marginTop: 16 }}>
          <Button
            disabled={cursorStack.length === 0}
            onClick={() => setCursorStack((prev) => prev.slice(0, -1))}
          >
            {t("common.previous")}
          </Button>
          <Button
            disabled={!engagementsQuery.data?.next_pagination_key}
            onClick={() => {
              const nextKey = engagementsQuery.data?.next_pagination_key;
              if (nextKey) {
                setCursorStack((prev) => [...prev, nextKey]);
              }
            }}
          >
            {t("common.next")}
          </Button>
        </Flex>
      </Card>

      <Modal
        title={t("marketplace.clients.declineModalTitle")}
        open={declineTarget !== undefined}
        onCancel={() => setDeclineTarget(undefined)}
        onOk={() => void handleDecline()}
        okText={t("common.decline")}
        okButtonProps={{ danger: true, loading: declineMutation.isPending }}
      >
        <Typography.Paragraph>
          {t("marketplace.clients.declineModalText", {
            client: declineTarget?.counterparty.display_name ?? "",
          })}
        </Typography.Paragraph>
      </Modal>
    </Space>
  );
}
