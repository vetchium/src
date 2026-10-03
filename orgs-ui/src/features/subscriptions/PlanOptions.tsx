import { CheckCircleFilled } from "@ant-design/icons";
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Flex,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type BillingInterval,
  entitlements,
  FreeTier,
  GoldTier,
  isOrgPlan,
  isUpgrade,
  type OrgPlan,
} from "typespec/orgs/subscriptions/plans";
import type { OrgSubscription } from "typespec/orgs/subscriptions/subscriptions";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { formatDate, formatPrice } from "./format";
import { planLabel } from "./labels";
import { presentablePlans } from "./offeredPlans";
import { planPrice } from "./prices";
import { useSetSubscriptionPlan } from "./queries";

interface OptionAction {
  label: string;
  disabled: boolean;
  confirm: boolean;
  onSelect: () => void;
}

export function PlanOptions({
  subscription,
  tenantID,
  configuredPlans,
  locale,
  changesLocked,
}: {
  subscription: OrgSubscription;
  tenantID: string;
  configuredPlans: readonly OrgPlan[];
  locale: string;
  /** True while the Org is suspended: choosing a plan is refused. */
  changesLocked: boolean;
}) {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const { token } = theme.useToken();
  const mutation = useSetSubscriptionPlan();
  const [selectedInterval, setSelectedInterval] = useState<BillingInterval>(
    subscription.billing_interval ?? "month",
  );
  useEffect(() => {
    if (subscription.billing_interval !== undefined) {
      setSelectedInterval(subscription.billing_interval);
    }
  }, [subscription.billing_interval]);

  const currentPlanKnown = isOrgPlan(subscription.plan_oid);
  const scheduledPlanKnown =
    subscription.scheduled_change === undefined ||
    isOrgPlan(subscription.scheduled_change.plan_oid);
  const knownState = currentPlanKnown && scheduledPlanKnown;
  const pastDue = subscription.billing_state === "past-due";
  const locked = !knownState || pastDue || changesLocked;

  const currentPlan = currentPlanKnown
    ? (subscription.plan_oid as OrgPlan)
    : FreeTier;
  const currentInterval = subscription.billing_interval;
  const effectiveDate =
    subscription.current_period_end === undefined
      ? undefined
      : formatDate(subscription.current_period_end, locale);

  function select(plan: OrgPlan, interval: BillingInterval | undefined) {
    mutation.mutate({
      plan_oid: plan,
      ...(interval === undefined ? {} : { billing_interval: interval }),
    });
  }

  function actionFor(
    plan: OrgPlan,
    interval: BillingInterval | undefined,
  ): OptionAction {
    if (
      currentPlanKnown &&
      currentPlan === plan &&
      currentInterval === interval
    ) {
      if (subscription.scheduled_change === undefined) {
        return {
          label: t("plans.actions.current"),
          disabled: true,
          confirm: false,
          onSelect: () => {},
        };
      }
      return {
        label: t("plans.actions.keep"),
        disabled: false,
        confirm: false,
        onSelect: () => select(plan, interval),
      };
    }
    if (isUpgrade(currentPlan, currentInterval, plan, interval)) {
      return {
        label:
          plan === currentPlan
            ? t("plans.actions.switchToAnnual")
            : t("plans.actions.upgrade"),
        disabled: false,
        confirm: false,
        onSelect: () => select(plan, interval),
      };
    }
    return {
      label:
        plan === FreeTier
          ? t("plans.actions.switchToFree")
          : t("plans.actions.switchAtPeriodEnd"),
      disabled: false,
      confirm: true,
      onSelect: () => select(plan, interval),
    };
  }

  function handleClick(action: OptionAction) {
    if (action.disabled || mutation.isPending) return;
    if (!action.confirm) {
      action.onSelect();
      return;
    }
    modal.confirm({
      title: t("plans.confirmTitle"),
      content:
        effectiveDate === undefined
          ? t("plans.confirmDescriptionNoDate")
          : t("plans.confirmDescription", { date: effectiveDate }),
      okText: action.label,
      cancelText: t("plans.confirmBack"),
      onOk: action.onSelect,
    });
  }

  const options = presentablePlans(tenantID, configuredPlans);
  const hasPaidPlan = options.some((plan) => plan !== FreeTier);
  const number = new Intl.NumberFormat(locale);

  function usersText(plan: OrgPlan): string {
    const held = entitlements[plan];
    return held.maxUsersWithGoogleSignIn === null
      ? t("plans.features.usersWithGoogle", {
          count: number.format(held.maxUsers),
        })
      : t("plans.features.users", { count: number.format(held.maxUsers) });
  }

  function planCard(plan: OrgPlan) {
    const held = entitlements[plan];
    const interval = plan === FreeTier ? undefined : selectedInterval;
    const action = actionFor(plan, interval);
    const label = planLabel(t, plan);
    const price =
      interval === undefined ? undefined : planPrice(tenantID, plan, interval);
    const isCurrent = currentPlanKnown && currentPlan === plan;
    const highlighted = isCurrent && plan !== FreeTier;

    const features = [
      usersText(plan),
      t("plans.features.openings", {
        count: number.format(held.openingsPerYear),
      }),
      ...(held.allowsLogo ? [t("plans.features.logo")] : []),
      ...(held.allowsGoogleSignIn ? [t("plans.features.googleSignIn")] : []),
    ];

    const card = (
      <Card
        role="region"
        aria-label={t("plans.planCardLabel", { plan: label })}
        data-testid={`plan-card-${plan}`}
        style={{
          height: "100%",
          width: "100%",
          ...(highlighted
            ? { borderColor: token.colorPrimary, borderWidth: 2 }
            : {}),
        }}
        styles={{ body: { height: "100%" } }}
      >
        <Flex orientation="vertical" gap="large" style={{ height: "100%" }}>
          <Flex align="center" gap="small" wrap>
            <Typography.Title level={2} style={{ margin: 0 }}>
              {label}
            </Typography.Title>
            {isCurrent ? (
              <Tag color="blue">{t("plans.currentBadge")}</Tag>
            ) : null}
          </Flex>
          <div>
            <Flex align="baseline" gap="small" wrap>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {price === undefined
                  ? t("plans.freePrice")
                  : formatPrice(price.amount, price.currency, locale)}
              </Typography.Title>
              <Typography.Text type="secondary">
                {interval === undefined
                  ? t("plans.freePriceCaption")
                  : t(`plans.pricePeriod.${interval}`)}
              </Typography.Text>
            </Flex>
            {price === undefined ? null : (
              <Typography.Text type="secondary">
                {t("plans.introductoryPricing")}
              </Typography.Text>
            )}
          </div>
          <Space orientation="vertical" size="middle">
            {features.map((feature) => (
              <Flex key={feature} align="start" gap="small">
                <CheckCircleFilled
                  style={{ color: token.colorSuccess, marginTop: 4 }}
                />
                <Typography.Text>{feature}</Typography.Text>
              </Flex>
            ))}
            {plan === GoldTier ? (
              <>
                <Flex align="start" gap="small">
                  <Tag>{t("plans.comingSoon")}</Tag>
                  <Typography.Text>
                    {t("plans.features.ticketSupport")}
                  </Typography.Text>
                </Flex>
                <Flex align="start" gap="small">
                  <Tag>{t("plans.comingSoon")}</Tag>
                  <Typography.Text>{t("plans.features.mcp")}</Typography.Text>
                </Flex>
              </>
            ) : null}
          </Space>
          <Button
            block
            size="large"
            type={plan === FreeTier ? "default" : "primary"}
            disabled={locked || action.disabled || mutation.isPending}
            loading={
              mutation.isPending &&
              mutation.variables?.plan_oid === plan &&
              mutation.variables.billing_interval === interval
            }
            onClick={() => handleClick(action)}
            style={{ marginTop: "auto" }}
          >
            {action.label}
          </Button>
        </Flex>
      </Card>
    );
    return plan === FreeTier ? (
      card
    ) : (
      <Badge.Ribbon
        text={highlighted ? t("plans.yourPlan") : t("plans.recommended")}
      >
        {card}
      </Badge.Ribbon>
    );
  }

  const comparisonRows = [
    {
      key: "users",
      label: t("plans.comparison.users"),
      value: (plan: OrgPlan) => usersText(plan),
    },
    {
      key: "openings",
      label: t("plans.comparison.openings"),
      value: (plan: OrgPlan) =>
        number.format(entitlements[plan].openingsPerYear),
    },
    {
      key: "logo",
      label: t("plans.comparison.logo"),
      value: (plan: OrgPlan) =>
        entitlements[plan].allowsLogo ? t("plans.yes") : t("plans.no"),
    },
    {
      key: "google",
      label: t("plans.comparison.googleSignIn"),
      value: (plan: OrgPlan) =>
        entitlements[plan].allowsGoogleSignIn ? t("plans.yes") : t("plans.no"),
    },
    {
      key: "tickets",
      label: t("plans.comparison.ticketSupport"),
      value: (plan: OrgPlan) =>
        entitlements[plan].includesTicketSupport
          ? t("plans.comingSoon")
          : t("plans.no"),
    },
    {
      key: "mcp",
      label: t("plans.comparison.mcp"),
      value: (plan: OrgPlan) =>
        plan === GoldTier ? t("plans.comingSoon") : t("plans.no"),
    },
  ];

  return (
    <Flex orientation="vertical" align="center" gap="large">
      {!knownState ? (
        <Alert
          type="warning"
          showIcon
          title={t("plans.unknownPlanTitle")}
          description={t("plans.unknownPlanDescription", {
            plan:
              subscription.scheduled_change !== undefined && !scheduledPlanKnown
                ? subscription.scheduled_change.plan_oid
                : subscription.plan_oid,
          })}
        />
      ) : null}
      {pastDue ? (
        <Alert type="warning" showIcon title={t("plans.lockedPastDue")} />
      ) : null}
      {changesLocked ? (
        <Alert type="warning" showIcon title={t("plans.lockedSuspended")} />
      ) : null}

      {hasPaidPlan ? (
        <Flex orientation="vertical" align="center" gap="small">
          <Flex align="center" justify="center" gap="small" wrap>
            <Segmented<BillingInterval>
              aria-label={t("plans.billingIntervalLabel")}
              size="large"
              shape="round"
              value={selectedInterval}
              options={[
                { label: t("plans.interval.month"), value: "month" },
                { label: t("plans.interval.year"), value: "year" },
              ]}
              onChange={(interval) => {
                mutation.reset();
                setSelectedInterval(interval);
              }}
            />
            <Tag color="green">{t("plans.annualSaving")}</Tag>
          </Flex>
          <Typography.Text type="secondary" style={{ textAlign: "center" }}>
            {t("plans.pricingNote")}
          </Typography.Text>
          <Typography.Text style={{ textAlign: "center" }} strong>
            {t("plans.fossNote")}
          </Typography.Text>
        </Flex>
      ) : null}

      <Row
        align="stretch"
        gutter={[24, 24]}
        justify="center"
        style={{ width: "100%" }}
      >
        {options.map((plan) => (
          <Col key={plan} xs={24} md={12} xl={8} style={{ display: "flex" }}>
            {planCard(plan)}
          </Col>
        ))}
      </Row>

      <APIErrorAlert error={mutation.error} />

      <Table
        size="small"
        pagination={false}
        style={{ width: "100%" }}
        rowKey="key"
        data-testid="plan-comparison"
        dataSource={comparisonRows}
        columns={[
          {
            title: t("plans.comparison.feature"),
            dataIndex: "label",
            key: "label",
          },
          ...options.map((plan) => ({
            title: planLabel(t, plan),
            key: plan,
            render: (_: unknown, row: (typeof comparisonRows)[number]) =>
              row.value(plan),
          })),
        ]}
      />
    </Flex>
  );
}
