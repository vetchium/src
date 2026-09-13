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
  Tag,
  Typography,
  theme,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type BillingInterval,
  FreeTier,
  type HubPlan,
  isHubPlan,
  isUpgrade,
} from "typespec/hub/subscriptions/plans";
import type { HubSubscription } from "typespec/hub/subscriptions/subscriptions";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { formatPrice } from "./format";
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
}: {
  subscription: HubSubscription;
  tenantID: string;
  configuredPlans: readonly HubPlan[];
  locale: string;
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

  const currentPlanKnown = isHubPlan(subscription.plan_oid);
  const scheduledPlanKnown =
    subscription.scheduled_change === undefined ||
    isHubPlan(subscription.scheduled_change.plan_oid);
  const knownState = currentPlanKnown && scheduledPlanKnown;

  const currentPlan = currentPlanKnown
    ? (subscription.plan_oid as HubPlan)
    : FreeTier;
  const currentInterval = subscription.billing_interval;
  const effectiveDate =
    subscription.current_period_end !== undefined
      ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
          new Date(subscription.current_period_end),
        )
      : undefined;

  function select(plan: HubPlan, interval: BillingInterval | undefined) {
    mutation.mutate({
      plan_oid: plan,
      ...(interval === undefined ? {} : { billing_interval: interval }),
    });
  }

  function actionFor(
    plan: HubPlan,
    interval: BillingInterval | undefined,
  ): OptionAction {
    const isCurrentActive =
      currentPlanKnown && currentPlan === plan && currentInterval === interval;
    if (isCurrentActive) {
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
    const upgrade = isUpgrade(currentPlan, currentInterval, plan, interval);
    if (upgrade) {
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

  function isPendingFor(
    plan: HubPlan,
    interval: BillingInterval | undefined,
  ): boolean {
    return (
      mutation.isPending &&
      mutation.variables?.plan_oid === plan &&
      mutation.variables.billing_interval === interval
    );
  }

  function featuresFor(plan: HubPlan): readonly string[] {
    if (plan === FreeTier) {
      return [
        t("plans.features.professionalProfile"),
        t("plans.features.standardPosts"),
        t("plans.features.professionalNetwork"),
      ];
    }
    return [
      t("plans.features.everythingInFree"),
      t("plans.features.longPosts"),
      t("plans.features.profilePictures"),
    ];
  }

  function planCard(plan: HubPlan) {
    const interval = plan === FreeTier ? undefined : selectedInterval;
    const action = actionFor(plan, interval);
    const label = planLabel(t, plan);
    const price =
      interval === undefined ? undefined : planPrice(tenantID, plan, interval);
    const isCurrent = currentPlanKnown && currentPlan === plan;

    const card = (
      <Card
        role="region"
        aria-label={t("plans.planCardLabel", { plan: label })}
        style={{ height: "100%", width: "100%" }}
        styles={{ body: { height: "100%" } }}
      >
        <Flex vertical gap="large" style={{ height: "100%" }}>
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
            <Typography.Paragraph type="secondary">
              {plan === FreeTier
                ? t("plans.descriptions.free")
                : t("plans.descriptions.silver")}
            </Typography.Paragraph>
          </div>

          <Space orientation="vertical" size="middle">
            <Typography.Text strong>{t("plans.featuresTitle")}</Typography.Text>
            {featuresFor(plan).map((feature) => (
              <Flex key={feature} align="start" gap="small">
                <CheckCircleFilled
                  style={{ color: token.colorSuccess, marginTop: 4 }}
                />
                <Typography.Text>{feature}</Typography.Text>
              </Flex>
            ))}
          </Space>

          {plan === FreeTier ? null : (
            <Alert type="success" showIcon title={t("plans.fossBullet")} />
          )}

          <Button
            block
            size="large"
            type={plan === FreeTier ? "default" : "primary"}
            disabled={!knownState || action.disabled || mutation.isPending}
            loading={isPendingFor(plan, interval)}
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
      <Badge.Ribbon text={t("plans.recommended")}>{card}</Badge.Ribbon>
    );
  }

  return (
    <Flex vertical align="center" gap="large">
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

      {hasPaidPlan ? (
        <Flex vertical align="center" gap="small">
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
        </Flex>
      ) : null}

      <Row
        align="stretch"
        gutter={[24, 24]}
        justify="center"
        style={{ width: "100%" }}
      >
        {options.map((plan) => (
          <Col key={plan} xs={24} md={12} xl={10} style={{ display: "flex" }}>
            {planCard(plan)}
          </Col>
        ))}
      </Row>

      <APIErrorAlert error={mutation.error} />
    </Flex>
  );
}
