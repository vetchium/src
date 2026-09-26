import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  CheckAbsent,
  type CheckDomainResponse,
  CheckInconclusive,
  CheckPresent,
  type MyInfoResponse,
  OrgSuspended,
} from "typespec/orgs/account/account";
import { orgsAPI } from "../../api/orgs";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey } from "../account/queries";

function resultKey(response: CheckDomainResponse): string {
  switch (response.check_result) {
    case CheckPresent:
      // A record found for a suspended Org whose domain another Org claimed
      // meanwhile cannot restore it.
      return response.org.org_state === OrgSuspended
        ? "domain.check.presentButClaimed"
        : "domain.check.present";
    case CheckAbsent:
      return "domain.check.absent";
    case CheckInconclusive:
      return "domain.check.inconclusive";
  }
}

function resultType(
  response: CheckDomainResponse,
): "success" | "warning" | "info" {
  if (response.check_result === CheckPresent) {
    return response.org.org_state === OrgSuspended ? "warning" : "success";
  }
  return response.check_result === CheckAbsent ? "warning" : "info";
}

/** The check-now action. Only a superadmin may run it; everyone else is told
 * whom to ask. */
export function DomainCheck({ canCheck }: { canCheck: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const check = useMutation({
    mutationFn: orgsAPI.checkDomain,
    onSuccess: (response) => {
      // A restored domain removes the banner or screen holding this action,
      // so the outcome is also announced outside it.
      if (resultType(response) === "success") {
        void message.success(t(resultKey(response)));
      }
      queryClient.setQueryData<MyInfoResponse>(myInfoQueryKey, (current) =>
        current === undefined ? current : { ...current, org: response.org },
      );
    },
  });

  if (!canCheck) {
    return (
      <Typography.Text type="secondary">
        {t("domain.check.superadminOnly")}
      </Typography.Text>
    );
  }
  return (
    <Flex orientation="vertical" gap="small" data-testid="domain-check">
      <div>
        <Button loading={check.isPending} onClick={() => check.mutate()}>
          {t("domain.check.action")}
        </Button>
      </div>
      {check.isSuccess ? (
        <div
          data-testid="domain-check-result"
          data-check-result={check.data.check_result}
        >
          <Alert
            type={resultType(check.data)}
            showIcon
            title={t(resultKey(check.data))}
          />
        </div>
      ) : null}
      <APIErrorAlert error={check.error} />
    </Flex>
  );
}
