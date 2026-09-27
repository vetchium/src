import { useQueryClient } from "@tanstack/react-query";
import { TwoFactorCard as SharedTwoFactorCard } from "@vetchium/portal-ui/security";
import { ReauthenticationAlert } from "@vetchium/portal-ui/shell";
import { isRecentAuthenticationRequired } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { useAuth } from "../../auth/AuthContext";
import { problemKeys } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey } from "../account/queries";
import { useRecoveryCodes } from "./RecoveryCodesContext";

export function TwoFactorCard({
  totpEnabled,
  recoveryCodesRemaining,
}: {
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
}) {
  const queryClient = useQueryClient();
  const { sessionToken } = useAuth();
  const { show } = useRecoveryCodes();
  return (
    <SharedTwoFactorCard
      totpEnabled={totpEnabled}
      recoveryCodesRemaining={recoveryCodesRemaining}
      sessionToken={sessionToken}
      operations={{
        start: orgsAPI.startTOTPEnrollment,
        confirm: (token, code, key) =>
          orgsAPI.confirmTOTPEnrollment(
            { totp_enrollment_token: token, totp_code: code },
            key,
          ),
        disable: orgsAPI.disableTOTP,
        regenerate: orgsAPI.regenerateRecoveryCodes,
      }}
      refreshProfile={() =>
        void queryClient.invalidateQueries({ queryKey: myInfoQueryKey })
      }
      showRecoveryCodes={show}
      isRecentAuthenticationRequired={isRecentAuthenticationRequired}
      reauthenticationAlert={<ReauthenticationAlert />}
      problemKeys={problemKeys}
      fallbackProblemKey="errors.generic"
      translations={{
        title: "security.twoFactor.title",
        description: "security.twoFactor.description",
        status: "security.twoFactor.status",
        statusEnabled: "security.twoFactor.statusEnabled",
        statusDisabled: "security.twoFactor.statusDisabled",
        recoveryCodes: "security.twoFactor.recoveryCodes",
        regenerate: "security.recoveryCodes.regenerate",
        regenerateConfirm: "security.recoveryCodes.regenerateConfirm",
        regenerated: "security.recoveryCodes.regenerated",
        disable: "security.twoFactor.disable",
        disableConfirm: "security.twoFactor.disableConfirm",
        disableWarning: "security.twoFactor.disableWarning",
        disabled: "security.twoFactor.disabled",
        start: "security.twoFactor.start",
        scan: "security.twoFactor.scan",
        qrLabel: "security.twoFactor.qrLabel",
        manualKey: "security.twoFactor.manualKey",
        algorithm: "security.twoFactor.algorithm",
        digits: "security.twoFactor.digits",
        period: "security.twoFactor.period",
        seconds: "security.twoFactor.seconds",
        expires: "security.twoFactor.expires",
        totpCode: "fields.totpCode",
        totpValidation: "validation.totpCode",
        confirm: "security.twoFactor.confirm",
        success: "security.twoFactor.enabled",
        required: "validation.required",
        cancel: "common.cancel",
        commonConfirm: "common.confirm",
      }}
    />
  );
}
