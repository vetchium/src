import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { FreeTier, planRank } from "typespec/hub/subscriptions/plans";
import { useMySubscriptionQuery } from "./queries";

/** PROF-SUB-001: the in-portal half of the ending-entitlement warning. The
 * email half is queued by the workers at the same seven-day and one-day
 * marks; this banner stays visible for the whole final week. */
const WARNING_WINDOW_DAYS = 7;

export function SubscriptionEndingAlert() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data } = useMySubscriptionQuery();
  if (data === undefined || data.current_period_end === undefined) return null;
  if (data.plan_oid === FreeTier) return null;
  const scheduled = data.scheduled_change;
  if (scheduled === undefined) return null;
  if (planRank(scheduled.plan_oid) >= planRank(data.plan_oid)) return null;

  const endsAt = new Date(data.current_period_end);
  const remaining = endsAt.getTime() - Date.now();
  if (remaining <= 0 || remaining > WARNING_WINDOW_DAYS * 86_400_000) {
    return null;
  }

  return (
    <Alert
      type="warning"
      showIcon
      closable
      title={t("plans.endingSoon", {
        date: new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "long",
        }).format(endsAt),
      })}
      description={t("plans.endingSoonDetail")}
      action={
        <Button size="small" onClick={() => void navigate("/plan")}>
          {t("plans.endingSoonAction")}
        </Button>
      }
    />
  );
}
