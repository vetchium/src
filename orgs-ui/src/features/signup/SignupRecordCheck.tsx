import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { checkSignupRecord } from "./api";
import type { RecordCheckResult } from "./dnsMessage";

const alertType = {
  present: "success",
  absent: "warning",
  inconclusive: "info",
} as const satisfies Record<RecordCheckResult, string>;

/** Tells the user whether public DNS already shows the record. It never
 * blocks submission: the region's API makes the deciding lookup. */
export function SignupRecordCheck({
  name,
  value,
}: {
  name: string;
  value: string;
}) {
  const { t } = useTranslation();
  const check = useQuery({
    queryKey: ["orgs", "signup-record", name, value],
    queryFn: ({ signal }) => checkSignupRecord(name, value, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (check.isFetching || check.data === undefined) {
    return (
      <div data-testid="signup-record-check" data-result="checking">
        <Alert
          type="info"
          showIcon
          icon={<Spin size="small" />}
          title={t("completeSignup.recordCheck.checking")}
        />
      </div>
    );
  }
  return (
    <div data-testid="signup-record-check" data-result={check.data}>
      <Alert
        type={alertType[check.data]}
        showIcon
        title={t(`completeSignup.recordCheck.${check.data}.title`)}
        description={t(`completeSignup.recordCheck.${check.data}.description`)}
        action={
          <Button size="small" onClick={() => void check.refetch()}>
            {t("completeSignup.recordCheck.again")}
          </Button>
        }
      />
    </div>
  );
}
