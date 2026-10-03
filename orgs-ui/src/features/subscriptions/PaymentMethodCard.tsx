import { Alert, Button, Card, Flex, Radio, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type PaymentMethodKind,
  paymentMethodKindValues,
} from "typespec/orgs/subscriptions/billing";
import type { OrgSubscription } from "typespec/orgs/subscriptions/subscriptions";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useRemovePaymentMethod, useSetPaymentMethod } from "./queries";

/**
 * The simulated test cards. There is no real card data: the choice only
 * decides whether a charge succeeds.
 */
export function PaymentMethodCard({
  subscription,
}: {
  subscription: OrgSubscription;
}) {
  const { t } = useTranslation();
  const save = useSetPaymentMethod();
  const remove = useRemovePaymentMethod();
  const saved = subscription.payment_method?.kind;
  const [choice, setChoice] = useState<PaymentMethodKind>(
    saved ?? "simulated-succeeds",
  );
  useEffect(() => {
    if (saved !== undefined) setChoice(saved);
  }, [saved]);

  return (
    <Card title={t("plans.payment.title")} data-testid="payment-method">
      <Flex orientation="vertical" gap="middle">
        <Alert type="info" showIcon title={t("plans.payment.simulated")} />
        <Typography.Text data-testid="payment-method-saved">
          {saved === undefined
            ? t("plans.payment.none")
            : t("plans.payment.saved", {
                card: t(`plans.payment.kinds.${saved}`),
              })}
        </Typography.Text>
        <Radio.Group
          aria-label={t("plans.payment.choose")}
          value={choice}
          onChange={(event) =>
            setChoice(event.target.value as PaymentMethodKind)
          }
          options={paymentMethodKindValues.map((kind) => ({
            value: kind,
            label: t(`plans.payment.kinds.${kind}`),
          }))}
        />
        <APIErrorAlert error={save.error ?? remove.error} />
        <Flex gap="small" wrap>
          <Button
            type="primary"
            loading={save.isPending}
            disabled={saved === choice}
            onClick={() => save.mutate({ kind: choice })}
          >
            {t("plans.payment.save")}
          </Button>
          {saved === undefined ? null : (
            <Button loading={remove.isPending} onClick={() => remove.mutate()}>
              {t("plans.payment.remove")}
            </Button>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
