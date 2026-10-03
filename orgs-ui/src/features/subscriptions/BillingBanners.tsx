import { Alert, Button, Flex } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { MyInfoResponse } from "typespec/orgs/account/account";
import { holds, ManageBilling } from "typespec/orgs/authorization/types";
import { FreeTier, isOrgPlan } from "typespec/orgs/subscriptions/plans";
import { paths } from "../../app/paths";
import { formatDateTime } from "./format";
import { planLabel } from "./labels";
import { useMySubscriptionQuery } from "./queries";

/**
 * What the shell tells a user about the Org's billing: an unpaid invoice to
 * everyone, a plan that is about to drop and a missing payment method to
 * billing holders.
 */
export function BillingBanners({
  me,
  locale,
}: {
  me: MyInfoResponse;
  locale: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const billingHolder = holds(me.permissions, ManageBilling);
  const paid = isOrgPlan(me.plan_oid) && me.plan_oid !== FreeTier;
  // The payment method is billing detail, so only billing holders read it.
  const subscription = useMySubscriptionQuery(billingHolder && paid);
  const notice = me.billing_notice;
  const goToPlans = () => navigate(paths.plans);

  const banners = [];
  if (notice?.kind === "past-due") {
    banners.push(
      <Alert
        key="past-due"
        type="error"
        showIcon
        data-testid="billing-banner-past-due"
        title={t("billing.banner.pastDue")}
        description={t("billing.banner.pastDueDetail", {
          deadline: formatDateTime(notice.at, locale),
        })}
        action={
          billingHolder ? (
            <Button danger onClick={goToPlans}>
              {t("plans.current.payNow")}
            </Button>
          ) : undefined
        }
      />,
    );
  }
  if (notice?.kind === "subscription-ending" && notice.banner) {
    banners.push(
      <Alert
        key="ending"
        type="warning"
        showIcon
        data-testid="billing-banner-ending"
        title={t("billing.banner.ending", {
          plan:
            notice.scheduled_plan_oid === undefined
              ? ""
              : planLabel(t, notice.scheduled_plan_oid),
          date: formatDateTime(notice.at, locale),
        })}
        description={t("billing.banner.endingDetail")}
        action={
          <Button onClick={goToPlans}>{t("billing.banner.managePlan")}</Button>
        }
      />,
    );
  }
  if (
    billingHolder &&
    paid &&
    subscription.isSuccess &&
    subscription.data.payment_method === undefined &&
    notice?.kind !== "past-due"
  ) {
    banners.push(
      <Alert
        key="no-method"
        type="info"
        showIcon
        data-testid="billing-banner-no-method"
        title={t("billing.banner.noMethod")}
        description={t("billing.banner.noMethodDetail")}
        action={
          <Button onClick={goToPlans}>{t("billing.banner.addMethod")}</Button>
        }
      />,
    );
  }
  if (banners.length === 0) return null;
  return (
    <Flex orientation="vertical" gap="small">
      {banners}
    </Flex>
  );
}
