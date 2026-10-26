import { ArrowLeftOutlined, CheckCircleFilled } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Flex,
  Modal,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { holds, ManageUsers } from "typespec/orgs/authorization/types";
import {
  type BillingInterval,
  entitlements,
  FreeTier,
  isOrgPlan,
  maxUsers,
  type OrgPlan,
  planRank,
} from "typespec/orgs/subscriptions/plans";
import type { OrgSubscription } from "typespec/orgs/subscriptions/subscriptions";
import { paths } from "../../app/paths";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useMyInfoQuery } from "../account/queries";
import { formatPrice } from "./format";
import { planLabel } from "./labels";
import { presentablePlans } from "./offeredPlans";
import { planPrice } from "./prices";
import { useSetSubscriptionPlan } from "./queries";

export function PlanOptions({
  subscription,
  tenantID,
  configuredPlans,
  locale,
  changesLocked,
  onDone,
}: {
  subscription: OrgSubscription;
  tenantID: string;
  configuredPlans: readonly OrgPlan[];
  locale: string;
  changesLocked: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { data: me } = useMyInfoQuery();
  const mutation = useSetSubscriptionPlan();
  const [interval, setInterval] = useState<BillingInterval>(
    subscription.billing_interval ?? "month",
  );
  const [target, setTarget] = useState<OrgPlan>();
  const known = isOrgPlan(subscription.plan_oid);
  const onPaidPlan = known && subscription.plan_oid !== FreeTier;
  const options = presentablePlans(tenantID, configuredPlans);
  const number = new Intl.NumberFormat(locale);
  const targetLimit =
    target === undefined
      ? null
      : maxUsers(target, me?.google_sign_in_enabled ?? false);
  const excess =
    targetLimit !== null && subscription.seats_in_use > targetLimit;
  const targetLabel =
    target === undefined
      ? ""
      : `${planLabel(t, target)}${target === FreeTier ? "" : ` (${t(`plans.interval.${interval}`)})`}`;
  const action = (plan: OrgPlan) =>
    plan === subscription.plan_oid
      ? plan === FreeTier || interval === subscription.billing_interval
        ? t("plans.actions.current")
        : t("plans.actions.interval")
      : plan === FreeTier
        ? t("plans.actions.switchToFree")
        : planRank(plan) > planRank(subscription.plan_oid)
          ? t("plans.actions.upgrade")
          : t("plans.actions.downgrade");
  const rows = [
    "users",
    "openings",
    "logo",
    "googleSignIn",
    "ai",
    "listings",
    "ticketSupport",
    "mcp",
  ] as const;
  const feature = (plan: OrgPlan, key: (typeof rows)[number]): string => {
    const held = entitlements[plan];
    switch (key) {
      case "users":
        return held.maxUsersWithGoogleSignIn === null
          ? t("plans.features.usersWithGoogle", {
              count: number.format(held.maxUsers),
            })
          : t("plans.features.users", { count: number.format(held.maxUsers) });
      case "openings":
        return t("plans.features.openings", {
          count: number.format(held.openingsPerYear),
        });
      case "logo":
        return t(held.allowsLogo ? "plans.yes" : "plans.no");
      case "googleSignIn":
        return t(held.allowsGoogleSignIn ? "plans.yes" : "plans.no");
      case "ai":
        return held.allowsAI
          ? t("plans.features.aiCredits", {
              count: number.format(held.aiCreditsPerMonth),
            })
          : t("plans.no");
      case "listings":
        return t(held.allowsListings ? "plans.yes" : "plans.no");
      default:
        return t(held.includesTicketSupport ? "plans.comingSoon" : "plans.no");
    }
  };
  const included = (plan: OrgPlan): readonly string[] => {
    const held = entitlements[plan];
    return [
      feature(plan, "users"),
      feature(plan, "openings"),
      ...(held.allowsLogo ? [t("plans.features.logo")] : []),
      ...(held.allowsGoogleSignIn ? [t("plans.features.googleSignIn")] : []),
      ...(held.allowsAI ? [feature(plan, "ai")] : []),
      ...(held.allowsListings ? [t("plans.features.listings")] : []),
    ];
  };
  // Matches the comparison table, where both rows follow ticket support.
  const comingSoon = (plan: OrgPlan): readonly string[] =>
    entitlements[plan].includesTicketSupport
      ? [t("plans.features.ticketSupport"), t("plans.features.mcp")]
      : [];

  const planCard = (plan: OrgPlan) => {
    const label = planLabel(t, plan);
    const price =
      plan === FreeTier ? undefined : planPrice(tenantID, plan, interval);
    const isCurrentPlan = plan === subscription.plan_oid;
    const current =
      isCurrentPlan &&
      (plan === FreeTier || subscription.billing_interval === interval);
    const upgrade = known && planRank(plan) > planRank(subscription.plan_oid);
    // A paying Org has already chosen: its plan leads, and Free stays
    // available as a quieter downgrade option.
    const highlighted = isCurrentPlan && plan !== FreeTier;
    const deemphasized = onPaidPlan && plan === FreeTier;
    const secondary = deemphasized ? "secondary" : undefined;
    return (
      <Card
        role="region"
        aria-label={t("plans.planCardLabel", { plan: label })}
        data-testid={`plan-${plan}`}
        variant={deemphasized ? "borderless" : "outlined"}
        style={{
          width: "100%",
          ...(highlighted
            ? { borderColor: token.colorPrimary, borderWidth: 2 }
            : {}),
          ...(deemphasized ? { background: token.colorFillQuaternary } : {}),
        }}
        styles={{ body: { height: "100%" } }}
      >
        <Flex orientation="vertical" gap="large" style={{ height: "100%" }}>
          <Flex align="center" gap="small" wrap>
            <Typography.Title level={2} type={secondary} style={{ margin: 0 }}>
              {label}
            </Typography.Title>
            {isCurrentPlan ? (
              <Tag color="blue">{t("plans.currentBadge")}</Tag>
            ) : null}
          </Flex>
          <div>
            <Flex align="baseline" gap="small" wrap>
              <Typography.Title
                level={3}
                type={secondary}
                style={{ margin: 0 }}
              >
                {price === undefined
                  ? t("plans.freePrice")
                  : formatPrice(price.amount, price.currency, locale)}
              </Typography.Title>
              <Typography.Text type="secondary">
                {price === undefined
                  ? t("plans.freePriceCaption")
                  : t(`plans.pricePeriod.${interval}`)}
              </Typography.Text>
            </Flex>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t(`plans.descriptions.${plan}`)}
            </Typography.Paragraph>
          </div>
          <Space orientation="vertical" size="middle">
            <Typography.Text strong type={secondary}>
              {t("plans.featuresTitle")}
            </Typography.Text>
            {included(plan).map((text) => (
              <Flex key={text} align="start" gap="small">
                <CheckCircleFilled
                  aria-hidden
                  style={{
                    color: deemphasized
                      ? token.colorTextQuaternary
                      : token.colorSuccess,
                    marginTop: 4,
                  }}
                />
                <Typography.Text type={secondary}>{text}</Typography.Text>
              </Flex>
            ))}
            {comingSoon(plan).map((text) => (
              <Flex key={text} align="start" gap="small" wrap>
                <Typography.Text type="secondary">{text}</Typography.Text>
                <Tag>{t("plans.comingSoon")}</Tag>
              </Flex>
            ))}
          </Space>
          <Button
            block
            size={deemphasized ? "middle" : "large"}
            type={deemphasized ? "text" : upgrade ? "primary" : "default"}
            disabled={current || !known || changesLocked}
            onClick={() => {
              mutation.reset();
              setTarget(plan);
            }}
            style={{ marginTop: "auto" }}
          >
            {action(plan)}
          </Button>
        </Flex>
      </Card>
    );
  };

  return (
    <Flex orientation="vertical" gap="large">
      <Flex>
        <Button icon={<ArrowLeftOutlined aria-hidden />} onClick={onDone}>
          {t("plans.back")}
        </Button>
      </Flex>
      {!known ? (
        <Alert
          type="warning"
          showIcon
          title={t("plans.unknownPlanTitle")}
          description={t("plans.unknownPlanDescription", {
            plan: subscription.plan_oid,
          })}
        />
      ) : null}
      <Flex orientation="vertical" align="center" gap="small">
        <Flex align="center" justify="center" gap="small" wrap>
          <Segmented<BillingInterval>
            aria-label={t("plans.billingIntervalLabel")}
            size="large"
            shape="round"
            value={interval}
            options={[
              { label: t("plans.interval.month"), value: "month" },
              { label: t("plans.interval.year"), value: "year" },
            ]}
            onChange={setInterval}
          />
          <Tag color="green">{t("plans.annualSaving")}</Tag>
        </Flex>
        <Typography.Text type="secondary" style={{ textAlign: "center" }}>
          {t("plans.pricingNote")}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ textAlign: "center" }}>
          {t("plans.development")}
        </Typography.Text>
      </Flex>
      <Row align="stretch" gutter={[24, 24]} justify="center">
        {options.map((plan) => (
          <Col key={plan} xs={24} md={12} xl={8} style={{ display: "flex" }}>
            {planCard(plan)}
          </Col>
        ))}
      </Row>
      <Alert type="success" showIcon title={t("plans.fossNote")} />
      <Collapse
        items={[
          {
            key: "comparison",
            label: t("plans.compare"),
            children: (
              <Table
                pagination={false}
                size="small"
                rowKey="key"
                dataSource={rows.map((key) => ({ key }))}
                columns={[
                  {
                    title: t("plans.comparison.feature"),
                    key: "feature",
                    render: (_, row) => t(`plans.comparison.${row.key}`),
                  },
                  ...options.map((plan) => ({
                    title: planLabel(t, plan),
                    key: plan,
                    render: (_: unknown, row: { key: (typeof rows)[number] }) =>
                      feature(plan, row.key),
                  })),
                ]}
              />
            ),
          },
        ]}
      />
      <Modal
        open={target !== undefined}
        title={t("plans.confirmTitle", { plan: targetLabel })}
        okText={target === undefined ? undefined : action(target)}
        cancelText={t("plans.confirmBack")}
        confirmLoading={mutation.isPending}
        okButtonProps={{ disabled: excess || changesLocked }}
        onCancel={() => {
          if (!mutation.isPending) setTarget(undefined);
        }}
        onOk={() => {
          if (target === undefined || excess) return;
          mutation.mutate(
            {
              plan_oid: target,
              ...(target === FreeTier ? {} : { billing_interval: interval }),
            },
            {
              onSuccess: () => {
                void message.success(t("plans.changed"));
                setTarget(undefined);
                onDone();
              },
            },
          );
        }}
      >
        <Flex orientation="vertical" gap="middle">
          <Typography.Paragraph>{t("plans.immediate")}</Typography.Paragraph>
          {target === undefined ? null : (
            <Descriptions
              column={1}
              items={rows.slice(0, 4).map((key) => ({
                key,
                label: t(
                  `plans.comparison.${key === "googleSignIn" ? "googleSignIn" : key}`,
                ),
                children: `${known ? feature(subscription.plan_oid as OrgPlan, key) : t("plans.unknownPlanTitle")} → ${feature(target, key)}`,
              }))}
            />
          )}
          {target !== undefined &&
          me?.logo_url !== undefined &&
          !entitlements[target].allowsLogo ? (
            <Alert type="warning" title={t("plans.losesLogo")} />
          ) : null}
          {target !== undefined &&
          me?.google_sign_in_enabled &&
          !entitlements[target].allowsGoogleSignIn ? (
            <Alert type="warning" title={t("plans.losesGoogle")} />
          ) : null}
          {excess ? (
            <Alert
              type="error"
              title={t("plans.excessSeats", {
                used: subscription.seats_in_use,
                limit: targetLimit,
              })}
              action={
                me !== undefined && holds(me.permissions, ManageUsers) ? (
                  <Link to={paths.members}>{t("navigation.members")}</Link>
                ) : undefined
              }
            />
          ) : null}
          <APIErrorAlert error={mutation.error} />
        </Flex>
      </Modal>
    </Flex>
  );
}
