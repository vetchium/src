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
  const { data: me } = useMyInfoQuery();
  const mutation = useSetSubscriptionPlan();
  const [interval, setInterval] = useState<BillingInterval>(
    subscription.billing_interval ?? "month",
  );
  const [target, setTarget] = useState<OrgPlan>();
  const known = isOrgPlan(subscription.plan_oid);
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
      default:
        return t(held.includesTicketSupport ? "plans.comingSoon" : "plans.no");
    }
  };
  return (
    <Flex orientation="vertical" gap="large">
      <Button onClick={onDone}>{t("plans.back")}</Button>
      {!known ? (
        <Alert
          type="warning"
          title={t("plans.unknownPlanTitle")}
          description={t("plans.unknownPlanDescription", {
            plan: subscription.plan_oid,
          })}
        />
      ) : null}
      <Space orientation="vertical">
        <Segmented<BillingInterval>
          aria-label={t("plans.billingIntervalLabel")}
          value={interval}
          options={[
            { label: t("plans.interval.month"), value: "month" },
            { label: t("plans.interval.year"), value: "year" },
          ]}
          onChange={setInterval}
        />
        <Typography.Text type="secondary">
          {t("plans.development")}
        </Typography.Text>
      </Space>
      <Row gutter={[16, 16]}>
        {options.map((plan) => {
          const price =
            plan === FreeTier ? undefined : planPrice(tenantID, plan, interval);
          const current =
            plan === subscription.plan_oid &&
            (plan === FreeTier || subscription.billing_interval === interval);
          return (
            <Col key={plan} xs={24} md={12} xl={8}>
              <Card
                title={planLabel(t, plan)}
                extra={current ? <Tag>{t("plans.actions.current")}</Tag> : null}
                data-testid={`plan-${plan}`}
              >
                <Flex orientation="vertical" gap="middle">
                  <Typography.Title level={3}>
                    {price === undefined
                      ? t("plans.freePrice")
                      : formatPrice(price.amount, price.currency, locale)}
                  </Typography.Title>
                  {price === undefined ? null : (
                    <Typography.Text type="secondary">
                      {t(`plans.pricePeriod.${interval}`)}
                    </Typography.Text>
                  )}
                  <Typography.Text>{feature(plan, "users")}</Typography.Text>
                  <Typography.Text>{feature(plan, "openings")}</Typography.Text>
                  <Typography.Text>
                    {t("plans.features.logo")}: {feature(plan, "logo")}
                  </Typography.Text>
                  <Typography.Text>
                    {t("plans.features.googleSignIn")}:{" "}
                    {feature(plan, "googleSignIn")}
                  </Typography.Text>
                  <Button
                    disabled={current || !known || changesLocked}
                    onClick={() => {
                      mutation.reset();
                      setTarget(plan);
                    }}
                  >
                    {action(plan)}
                  </Button>
                </Flex>
              </Card>
            </Col>
          );
        })}
      </Row>
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
