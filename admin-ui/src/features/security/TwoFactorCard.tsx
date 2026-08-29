import { useQueryClient } from "@tanstack/react-query";
import { TwoFactorCard as SharedTwoFactorCard } from "@vetchium/portal-ui/security";
import { IncorrectTOTPCodeError } from "typespec/problem/admin/authentication";
import {
  InvalidTOTPEnrollmentError,
  TOTPAlreadyEnabledError,
  TOTPNotEnabledError,
} from "typespec/problem/admin/totp";
import { IdempotencyKeyConflictError } from "typespec/problem/common";
import { isRecentAuthenticationRequired } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { myInfoQueryKey } from "../profile/queries";
import {
  confirmTOTPEnrollment,
  disableTOTP,
  regenerateTOTPRecoveryCodes,
  startTOTPEnrollment,
} from "./api";
import { useRecoveryCodes } from "./RecoveryCodesContext";

const problemKeys = {
  [IncorrectTOTPCodeError.type]: "security.twoFactor.errors.incorrectCode",
  [InvalidTOTPEnrollmentError.type]:
    "security.twoFactor.errors.invalidEnrollment",
  [TOTPAlreadyEnabledError.type]: "security.twoFactor.errors.alreadyEnabled",
  [TOTPNotEnabledError.type]: "security.twoFactor.errors.notEnabled",
  [IdempotencyKeyConflictError.type]: "common.idempotencyConflict",
};

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
        start: startTOTPEnrollment,
        confirm: (token, code, key) =>
          confirmTOTPEnrollment(
            { totp_enrollment_token: token, totp_code: code },
            key,
          ),
        disable: disableTOTP,
        regenerate: regenerateTOTPRecoveryCodes,
      }}
      refreshProfile={() =>
        void queryClient.invalidateQueries({ queryKey: myInfoQueryKey })
      }
      showRecoveryCodes={show}
      isRecentAuthenticationRequired={isRecentAuthenticationRequired}
      reauthenticationAlert={<ReauthenticationAlert />}
      problemKeys={problemKeys}
      fallbackProblemKey="common.requestError"
      translations={{
        title: "security.twoFactor.card",
        description: "security.twoFactor.description",
        status: "fields.twoFactor",
        statusEnabled: "common.enabled",
        statusDisabled: "common.disabled",
        recoveryCodes: "fields.recoveryCodes",
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
        expires: "security.twoFactor.enrollmentExpires",
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
