import { Alert, Button, Card, Descriptions, Flex } from "antd";
import { useTranslation } from "react-i18next";
import type { OrgSubscription } from "typespec/orgs/subscriptions/subscriptions";
import { planLabel } from "./labels";

export function CurrentSubscriptionCard({
  subscription,
  locked,
  onChange,
}: {
  subscription: OrgSubscription;
  locked: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card title={t("plans.current.title")} data-testid="current-subscription">
      <Flex orientation="vertical" gap="middle" align="start">
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
              key: "seats",
              label: t("plans.current.seatsLabel"),
              children:
                subscription.seat_limit === undefined
                  ? t("plans.current.seatsUnlimited", {
                      used: subscription.seats_in_use,
                    })
                  : t("plans.current.seats", {
                      used: subscription.seats_in_use,
                      limit: subscription.seat_limit,
                    }),
            },
          ]}
        />
        {locked ? (
          <Alert type="warning" title={t("plans.lockedSuspended")} />
        ) : (
          <Button type="primary" onClick={onChange}>
            {t("plans.change")}
          </Button>
        )}
      </Flex>
    </Card>
  );
}
