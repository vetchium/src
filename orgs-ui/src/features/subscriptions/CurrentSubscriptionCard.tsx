import { Alert, Button, Card, Descriptions, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { isOrgPlan } from "typespec/orgs/subscriptions/plans";
import type { OrgSubscription } from "typespec/orgs/subscriptions/subscriptions";
import { formatDate, formatDateTime } from "./format";
import { planLabel } from "./labels";
import { usePayInvoice } from "./queries";

export function CurrentSubscriptionCard({
  subscription,
  locale,
}: {
  subscription: OrgSubscription;
  locale: string;
}) {
  const { t } = useTranslation();
  const pay = usePayInvoice();
  const open = subscription.open_invoice;
  const seats =
    subscription.seat_limit === undefined
      ? t("plans.current.seatsUnlimited", { used: subscription.seats_in_use })
      : t("plans.current.seats", {
          used: subscription.seats_in_use,
          limit: subscription.seat_limit,
        });

  return (
    <Card title={t("plans.current.title")} data-testid="current-subscription">
      {open === undefined ? null : (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("plans.current.pastDue")}
          description={t("plans.current.pastDueDetail", {
            deadline: formatDateTime(open.due_at ?? open.period_end, locale),
          })}
          action={
            <Button
              danger
              loading={pay.isPending}
              onClick={() => pay.mutate(open)}
            >
              {t("plans.current.payNow")}
            </Button>
          }
        />
      )}
      <Descriptions
        column={1}
        items={[
          {
            key: "plan",
            label: t("plans.current.plan"),
            children: (
              <span data-testid="current-plan">
                {planLabel(t, subscription.plan_oid)}
                {subscription.billing_interval === undefined
                  ? null
                  : ` · ${t(`plans.interval.${subscription.billing_interval}`)}`}
              </span>
            ),
          },
          {
            key: "state",
            label: t("plans.current.state"),
            children: (
              <Tag
                color={
                  subscription.billing_state === "current" ? "green" : "red"
                }
              >
                {t(`plans.billingState.${subscription.billing_state}`)}
              </Tag>
            ),
          },
          ...(subscription.current_period_end === undefined
            ? []
            : [
                {
                  key: "renews",
                  label: t(
                    subscription.scheduled_change === undefined
                      ? "plans.current.renews"
                      : "plans.current.ends",
                  ),
                  children: formatDate(subscription.current_period_end, locale),
                },
              ]),
          ...(subscription.scheduled_change === undefined
            ? []
            : [
                {
                  key: "scheduled",
                  label: t("plans.current.scheduled"),
                  children: (
                    <span data-testid="scheduled-change">
                      {planLabel(t, subscription.scheduled_change.plan_oid)}
                    </span>
                  ),
                },
              ]),
          {
            key: "seats",
            label: t("plans.current.seatsLabel"),
            children: <span data-testid="current-seats">{seats}</span>,
          },
        ]}
      />
      {!isOrgPlan(subscription.plan_oid) ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          title={t("plans.unknownPlanTitle")}
          description={t("plans.unknownPlanDescription", {
            plan: subscription.plan_oid,
          })}
        />
      ) : null}
    </Card>
  );
}
