import { Alert, Card, Descriptions } from "antd";
import { useTranslation } from "react-i18next";
import { FreeTier } from "typespec/hub/subscriptions/plans";
import type { HubSubscription } from "typespec/hub/subscriptions/subscriptions";
import { planLabel } from "./labels";

export function CurrentSubscriptionCard({
  subscription,
  locale,
}: {
  subscription: HubSubscription;
  locale: string;
}) {
  const { t } = useTranslation();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long" });

  if (
    subscription.plan_oid === FreeTier &&
    subscription.scheduled_change === undefined
  ) {
    return null;
  }

  const items = [
    {
      key: "plan",
      label: t("plans.currentPlan"),
      children: planLabel(t, subscription.plan_oid),
    },
  ];
  if (subscription.billing_interval !== undefined) {
    items.push({
      key: "interval",
      label: t("plans.currentInterval"),
      children: t(`plans.interval.${subscription.billing_interval}`),
    });
  }
  if (
    subscription.current_period_start !== undefined &&
    subscription.current_period_end !== undefined
  ) {
    items.push({
      key: "period",
      label: t("plans.currentPeriod"),
      children: t("plans.periodRange", {
        start: dateFormatter.format(
          new Date(subscription.current_period_start),
        ),
        end: dateFormatter.format(new Date(subscription.current_period_end)),
      }),
    });
  }

  const scheduledChangeText = (() => {
    const change = subscription.scheduled_change;
    if (change === undefined || subscription.current_period_end === undefined) {
      return undefined;
    }
    const effective = dateFormatter.format(
      new Date(subscription.current_period_end),
    );
    if (subscription.cancel_at_period_end) {
      return t("plans.scheduledCancellation", { date: effective });
    }
    return t("plans.scheduledChange", {
      plan: planLabel(t, change.plan_oid),
      interval:
        change.billing_interval === undefined
          ? ""
          : t(`plans.interval.${change.billing_interval}`),
      date: effective,
    });
  })();

  return (
    <Card title={t("plans.currentTitle")}>
      <Descriptions column={1} items={items} />
      {scheduledChangeText !== undefined ? (
        <Alert type="info" showIcon title={scheduledChangeText} />
      ) : null}
    </Card>
  );
}
