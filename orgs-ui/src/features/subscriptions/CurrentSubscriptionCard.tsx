import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Progress,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";
import type { OrgSubscription } from "typespec/orgs/subscriptions/subscriptions";
import { planLabel } from "./labels";

/** Share of the seat cap at which the gauge turns to a warning. */
const SEAT_WARNING_PERCENT = 80;

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
  const { token } = theme.useToken();
  const limit = subscription.seat_limit;
  const used = subscription.seats_in_use;
  const percent =
    limit === undefined || limit === 0
      ? undefined
      : Math.min(100, Math.floor((used / limit) * 100));
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
                <Typography.Text strong data-testid="current-plan">
                  {planLabel(t, subscription.plan_oid)}
                  {subscription.billing_interval === undefined
                    ? null
                    : ` · ${t(`plans.interval.${subscription.billing_interval}`)}`}
                </Typography.Text>
              ),
            },
            {
              key: "seats",
              label: t("plans.current.seatsLabel"),
              children: (
                <Flex orientation="vertical" gap="small" style={{ flex: 1 }}>
                  <Typography.Text>
                    {limit === undefined
                      ? t("plans.current.seatsUnlimited", { used })
                      : t("plans.current.seats", { used, limit })}
                  </Typography.Text>
                  {percent === undefined || limit === undefined ? null : (
                    <Progress
                      aria-label={t("plans.current.seatsLabel")}
                      percent={percent}
                      showInfo={false}
                      status={used >= limit ? "exception" : "normal"}
                      strokeColor={
                        used < limit && percent >= SEAT_WARNING_PERCENT
                          ? token.colorWarning
                          : undefined
                      }
                    />
                  )}
                </Flex>
              ),
            },
          ]}
        />
        {locked ? (
          <Alert type="warning" showIcon title={t("plans.lockedSuspended")} />
        ) : (
          <Button type="primary" onClick={onChange}>
            {t("plans.change")}
          </Button>
        )}
      </Flex>
    </Card>
  );
}
