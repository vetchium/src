import { PlusOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Flex,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PipelineStageID } from "typespec/orgs/hiring/pipelines";
import type {
  Assignment,
  StageAssignments,
} from "typespec/orgs/marketplace/assignments";
import {
  maxOpeningAgencies,
  maxStageProviders,
} from "typespec/orgs/marketplace/assignments";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type { Engagement } from "typespec/orgs/marketplace/engagements";
import { stageKindLabel } from "../applications/presentation";
import { marketplaceProblem } from "./problems";
import {
  useAssignOpeningProviderMutation,
  useConsumerEngagementsQuery,
  useOpeningProvidersQuery,
  useUnassignOpeningProviderMutation,
} from "./queries";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts[parts.length - 1]?.charAt(0) ?? "";
  if (parts.length === 0) return "O";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "O";
  return (first + last).toUpperCase();
}

interface Props {
  openingNumber: number;
  canManage: boolean;
}

export function OpeningProvidersTab({ openingNumber, canManage }: Props) {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const { message: toast } = App.useApp();

  const providersQuery = useOpeningProvidersQuery(openingNumber);
  const providers = providersQuery.data;

  // Active engagements for modal pickers
  const allActiveEngagements = useConsumerEngagementsQuery({
    state: "active",
    limit: 100,
  });

  const assignMutation = useAssignOpeningProviderMutation(openingNumber);
  const unassignMutation = useUnassignOpeningProviderMutation(openingNumber);
  const assignKey = useIdempotencyKey(`assign-provider:${openingNumber}`);
  const unassignKey = useIdempotencyKey(`unassign-provider:${openingNumber}`);

  // Agency modal state
  const [assignAgencyOpen, setAssignAgencyOpen] = useState(false);
  const [selectedAgencyId, setSelectedAgencyId] = useState<string>();

  // Stage provider modal state
  const [assignStageProviderStage, setAssignStageProviderStage] = useState<{
    id: PipelineStageID;
    name: string;
    kind: string;
  }>();
  const [selectedStageEngagementId, setSelectedStageEngagementId] =
    useState<string>();

  if (providersQuery.isLoading) return <Card loading />;
  if (providersQuery.isError || !providers) {
    return (
      <Alert
        type="error"
        showIcon
        title={t("marketplace.openingProviders.loadError")}
      />
    );
  }

  const assignedAgencyIds = new Set(
    providers.agencies.map((a) => a.engagement_id),
  );
  const availableAgencies = (
    allActiveEngagements.data?.engagements ?? []
  ).filter((e) => e.capability === "sourcing" && !assignedAgencyIds.has(e.id));

  const getStageCapability = (kind: string): Capability | undefined => {
    if (kind === "interview") return "interviewing";
    if (kind === "assessment") return "assessment";
    if (kind === "background_check") return "background_check";
    return undefined;
  };

  const currentStageCap = assignStageProviderStage
    ? getStageCapability(assignStageProviderStage.kind)
    : undefined;

  const currentStageAssignedIds = new Set(
    (
      providers.stages.find((s) => s.stage.id === assignStageProviderStage?.id)
        ?.assignments ?? []
    ).map((a) => a.engagement_id),
  );

  const availableStageEngagements = (
    allActiveEngagements.data?.engagements ?? []
  ).filter(
    (e) =>
      e.capability === currentStageCap && !currentStageAssignedIds.has(e.id),
  );

  const handleAssignAgency = async () => {
    if (!selectedAgencyId) return;
    try {
      await assignMutation.mutateAsync({
        request: {
          opening_number: openingNumber,
          engagement_id: selectedAgencyId,
        },
        key: assignKey.current(),
      });
      assignKey.rotate();
      void toast.success(t("marketplace.openingProviders.agencyAssigned"));
      setAssignAgencyOpen(false);
      setSelectedAgencyId(undefined);
    } catch (err) {
      const prob = marketplaceProblem(err);
      if (prob.kind === "assignment-limit-reached") {
        void toast.error(t("marketplace.errors.agencyLimitReached"));
      } else {
        void toast.error(t("marketplace.errors.genericAssignFailed"));
      }
    }
  };

  const handleRemoveAgency = async (engagementId: string) => {
    try {
      await unassignMutation.mutateAsync({
        request: {
          opening_number: openingNumber,
          engagement_id: engagementId,
        },
        key: unassignKey.current(),
      });
      unassignKey.rotate();
      void toast.success(t("marketplace.openingProviders.agencyRemoved"));
    } catch {
      void toast.error(t("marketplace.errors.genericUnassignFailed"));
    }
  };

  const handleAssignStageProvider = async () => {
    if (!selectedStageEngagementId || !assignStageProviderStage) return;
    try {
      await assignMutation.mutateAsync({
        request: {
          opening_number: openingNumber,
          stage_id: assignStageProviderStage.id,
          engagement_id: selectedStageEngagementId,
        },
        key: assignKey.current(),
      });
      assignKey.rotate();
      void toast.success(
        t("marketplace.openingProviders.stageProviderAssigned"),
      );
      setAssignStageProviderStage(undefined);
      setSelectedStageEngagementId(undefined);
    } catch (err) {
      const prob = marketplaceProblem(err);
      if (prob.kind === "assignment-limit-reached") {
        void toast.error(t("marketplace.errors.stageLimitReached"));
      } else if (prob.kind === "capability-mismatch") {
        void toast.error(t("marketplace.errors.capabilityMismatch"));
      } else {
        void toast.error(t("marketplace.errors.genericAssignFailed"));
      }
    }
  };

  const handleRemoveStageProvider = async (
    stageId: PipelineStageID,
    engagementId: string,
  ) => {
    try {
      await unassignMutation.mutateAsync({
        request: {
          opening_number: openingNumber,
          stage_id: stageId,
          engagement_id: engagementId,
        },
        key: unassignKey.current(),
      });
      unassignKey.rotate();
      void toast.success(
        t("marketplace.openingProviders.stageProviderRemoved"),
      );
    } catch {
      void toast.error(t("marketplace.errors.genericUnassignFailed"));
    }
  };

  const agencyColumns: ColumnsType<Assignment> = [
    {
      title: t("marketplace.columns.agency"),
      key: "agency",
      render: (_, a) => (
        <Flex gap="small" align="center">
          <Avatar size="small" style={{ backgroundColor: "#2563eb" }}>
            {getInitials(a.counterparty.display_name)}
          </Avatar>
          <Flex vertical>
            <Typography.Text strong>
              {a.counterparty.display_name}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {a.counterparty.domain}
            </Typography.Text>
          </Flex>
        </Flex>
      ),
    },
    {
      title: t("marketplace.columns.assigned"),
      key: "assigned",
      render: (_, a) => date(a.assigned_at),
    },
    {
      title: "",
      key: "actions",
      align: "end",
      render: (_, a) =>
        canManage ? (
          <Button
            size="small"
            danger
            loading={unassignMutation.isPending}
            onClick={() => void handleRemoveAgency(a.engagement_id)}
          >
            {t("common.remove")}
          </Button>
        ) : null,
    },
  ];

  return (
    <Flex vertical gap="middle">
      <Card
        title={t("marketplace.openingProviders.sourcingAgencies")}
        extra={
          <Flex gap="small" align="center">
            <Typography.Text type="secondary">
              {t("marketplace.openingProviders.limitCount", {
                count: providers.agencies.length,
                max: maxOpeningAgencies,
              })}
            </Typography.Text>
            {canManage && (
              <Button
                icon={<PlusOutlined />}
                disabled={providers.agencies.length >= maxOpeningAgencies}
                onClick={() => setAssignAgencyOpen(true)}
              >
                {t("marketplace.openingProviders.assignAgency")}
              </Button>
            )}
          </Flex>
        }
      >
        <Typography.Paragraph type="secondary">
          {t("marketplace.openingProviders.sourcingIntro")}
        </Typography.Paragraph>

        <Table<Assignment>
          rowKey="engagement_id"
          pagination={false}
          dataSource={providers.agencies}
          columns={agencyColumns}
        />
      </Card>

      <Card title={t("marketplace.openingProviders.stageProviders")}>
        <Typography.Paragraph type="secondary">
          {t("marketplace.openingProviders.stageIntro")}
        </Typography.Paragraph>

        <Flex vertical gap="small">
          {providers.stages.map((s: StageAssignments, index: number) => {
            const isReview = s.stage.kind === "review";
            const canAssignToStage =
              canManage &&
              !isReview &&
              s.assignments.length < maxStageProviders;

            return (
              <Card
                key={s.stage.id}
                size="small"
                title={
                  <Flex gap="small" align="center">
                    <Typography.Text strong>
                      {index + 1}. {s.stage.name}
                    </Typography.Text>
                    <Tag>{stageKindLabel(t, s.stage.kind)}</Tag>
                  </Flex>
                }
                extra={
                  canAssignToStage ? (
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setAssignStageProviderStage({
                          id: s.stage.id,
                          name: s.stage.name,
                          kind: s.stage.kind,
                        });
                        setSelectedStageEngagementId(undefined);
                      }}
                    >
                      {t("marketplace.openingProviders.assignProvider")}
                    </Button>
                  ) : null
                }
              >
                {isReview ? (
                  <Typography.Text type="secondary">
                    {t("marketplace.openingProviders.reviewInHouseOnly")}
                  </Typography.Text>
                ) : s.assignments.length === 0 ? (
                  <Typography.Text type="secondary">
                    {t("marketplace.openingProviders.noProvidersAssigned")}
                  </Typography.Text>
                ) : (
                  <Flex vertical gap="small">
                    {s.assignments.map((a: Assignment) => (
                      <Flex
                        key={a.engagement_id}
                        justify="space-between"
                        align="center"
                      >
                        <Flex gap="small" align="center">
                          <Avatar
                            size="small"
                            style={{ backgroundColor: "#2563eb" }}
                          >
                            {getInitials(a.counterparty.display_name)}
                          </Avatar>
                          <Flex vertical>
                            <Typography.Text strong>
                              {a.counterparty.display_name}
                            </Typography.Text>
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: 12 }}
                            >
                              {a.counterparty.domain}
                            </Typography.Text>
                          </Flex>
                        </Flex>

                        {canManage && (
                          <Button
                            size="small"
                            danger
                            loading={unassignMutation.isPending}
                            onClick={() =>
                              void handleRemoveStageProvider(
                                s.stage.id,
                                a.engagement_id,
                              )
                            }
                          >
                            {t("common.remove")}
                          </Button>
                        )}
                      </Flex>
                    ))}
                  </Flex>
                )}
              </Card>
            );
          })}
        </Flex>
      </Card>

      {/* Modal: Assign agency */}
      <Modal
        title={t("marketplace.openingProviders.assignAgencyModalTitle")}
        open={assignAgencyOpen}
        onCancel={() => {
          setAssignAgencyOpen(false);
          setSelectedAgencyId(undefined);
        }}
        onOk={() => void handleAssignAgency()}
        okText={t("common.assign")}
        okButtonProps={{
          disabled: !selectedAgencyId,
          loading: assignMutation.isPending,
        }}
      >
        <Typography.Paragraph type="secondary">
          {t("marketplace.openingProviders.assignAgencyModalIntro")}
        </Typography.Paragraph>

        {availableAgencies.length === 0 ? (
          <Alert
            type="info"
            message={t("marketplace.openingProviders.noAvailableAgencies")}
          />
        ) : (
          <Radio.Group
            value={selectedAgencyId}
            onChange={(e) => setSelectedAgencyId(e.target.value)}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {availableAgencies.map((e: Engagement) => (
                <Radio key={e.id} value={e.id}>
                  <Typography.Text strong>
                    {e.counterparty.display_name}
                  </Typography.Text>{" "}
                  <Typography.Text type="secondary">
                    ({e.counterparty.domain})
                  </Typography.Text>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        )}
      </Modal>

      {/* Modal: Assign stage provider */}
      <Modal
        title={t("marketplace.openingProviders.assignStageProviderModalTitle", {
          stage: assignStageProviderStage?.name ?? "",
        })}
        open={assignStageProviderStage !== undefined}
        onCancel={() => {
          setAssignStageProviderStage(undefined);
          setSelectedStageEngagementId(undefined);
        }}
        onOk={() => void handleAssignStageProvider()}
        okText={t("common.assign")}
        okButtonProps={{
          disabled: !selectedStageEngagementId,
          loading: assignMutation.isPending,
        }}
      >
        <Typography.Paragraph type="secondary">
          {t("marketplace.openingProviders.assignStageProviderModalIntro")}
        </Typography.Paragraph>

        {availableStageEngagements.length === 0 ? (
          <Alert
            type="info"
            message={t(
              "marketplace.openingProviders.noAvailableStageProviders",
            )}
          />
        ) : (
          <Radio.Group
            value={selectedStageEngagementId}
            onChange={(e) => setSelectedStageEngagementId(e.target.value)}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {availableStageEngagements.map((e: Engagement) => (
                <Radio key={e.id} value={e.id}>
                  <Typography.Text strong>
                    {e.counterparty.display_name}
                  </Typography.Text>{" "}
                  <Typography.Text type="secondary">
                    ({e.counterparty.domain})
                  </Typography.Text>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        )}
      </Modal>
    </Flex>
  );
}
