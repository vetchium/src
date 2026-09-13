import { Alert, App, Button, Card, Flex, Typography } from "antd";
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
  const mutation = useSetSubscriptionPlan();

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
      currentPlan === plan && currentInterval === interval;
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
          ? t("plans.actions.cancel")
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
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: action.onSelect,
    });
  }

  const options = presentablePlans(tenantID, configuredPlans);

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

  return (
    <Flex vertical gap="middle">
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
      <Flex gap="middle" wrap>
        {options.map((plan) => {
          if (plan === FreeTier) {
            const action = actionFor(plan, undefined);
            return (
              <Card key={plan} title={planLabel(t, plan)}>
                <Button
                  block
                  disabled={
                    !knownState || action.disabled || mutation.isPending
                  }
                  loading={isPendingFor(plan, undefined)}
                  onClick={() => handleClick(action)}
                >
                  {action.label}
                </Button>
              </Card>
            );
          }
          return (
            <Card key={plan} title={planLabel(t, plan)}>
              <Flex vertical gap="small">
                <Alert type="success" showIcon title={t("plans.fossBullet")} />
                {(["month", "year"] as const).map((interval) => {
                  const price = planPrice(tenantID, plan, interval);
                  if (price === undefined) return null;
                  const action = actionFor(plan, interval);
                  const intervalLabel = t(`plans.interval.${interval}`);
                  return (
                    <Flex
                      key={interval}
                      justify="space-between"
                      align="center"
                      gap="small"
                    >
                      <Typography.Text>
                        {intervalLabel}:{" "}
                        {formatPrice(price.amount, price.currency, locale)}
                      </Typography.Text>
                      <Button
                        aria-label={`${action.label} (${intervalLabel})`}
                        disabled={
                          !knownState || action.disabled || mutation.isPending
                        }
                        loading={isPendingFor(plan, interval)}
                        onClick={() => handleClick(action)}
                      >
                        {action.label}
                      </Button>
                    </Flex>
                  );
                })}
              </Flex>
            </Card>
          );
        })}
      </Flex>
      <APIErrorAlert error={mutation.error} />
    </Flex>
  );
}
