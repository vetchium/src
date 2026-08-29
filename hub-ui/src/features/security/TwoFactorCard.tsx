import { useQueryClient } from "@tanstack/react-query";
import { TwoFactorCard as SharedTwoFactorCard } from "@vetchium/portal-ui/security";
import { isRecentAuthenticationRequired } from "../../api/client";
import { hubAPI } from "../../api/hub";
import { useAuth } from "../../auth/AuthContext";
import { problemKeys } from "../../components/common/APIErrorAlert";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { myInfoQueryKey } from "../profile/queries";
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
        start: hubAPI.startTOTPEnrollment,
        confirm: (token, code, key) =>
          hubAPI.confirmTOTPEnrollment(
            { totp_enrollment_token: token, totp_code: code },
            key,
          ),
        disable: hubAPI.disableTOTP,
        regenerate: hubAPI.regenerateRecoveryCodes,
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
        title: "tfa.title",
        description: "tfa.description",
        status: "fields.twoFactor",
        statusEnabled: "common.enabled",
        statusDisabled: "common.disabled",
        recoveryCodes: "fields.recoveryCodes",
        regenerate: "tfa.regenerate",
        regenerateConfirm: "tfa.regenerateConfirm",
        regenerated: "tfa.regenerated",
        disable: "tfa.disable",
        disableConfirm: "tfa.disableConfirm",
        disableWarning: "tfa.disableWarning",
        disabled: "tfa.disabled",
        start: "tfa.enable",
        scan: "tfa.enrollmentInstructions",
        qrLabel: "tfa.qrLabel",
        manualKey: "tfa.manualKey",
        algorithm: "tfa.algorithm",
        digits: "tfa.digits",
        period: "tfa.period",
        seconds: "tfa.seconds",
        expires: "tfa.expires",
        totpCode: "fields.totpCode",
        totpValidation: "validation.totp",
        confirm: "tfa.confirm",
        success: "tfa.enabled",
        required: "validation.required",
        cancel: "common.cancel",
        commonConfirm: "common.confirm",
      }}
    />
  );
}
