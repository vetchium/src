import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import { APIError } from "../../api/client";

const problemKeys: Record<string, string> = {
  "vetchium-problem-details/hub-invalid-credentials":
    "errors.invalidCredentials",
  "vetchium-problem-details/hub-signup-domain-not-allowed":
    "errors.signupDomainNotAllowed",
  "vetchium-problem-details/hub-invalid-signup-token":
    "errors.invalidSignupToken",
  "vetchium-problem-details/hub-invalid-password-reset-token":
    "errors.invalidResetToken",
  "vetchium-problem-details/hub-incorrect-password": "errors.incorrectPassword",
  "vetchium-problem-details/hub-incorrect-totp-code": "errors.incorrectTOTP",
  "vetchium-problem-details/hub-incorrect-recovery-code":
    "errors.incorrectRecoveryCode",
  "vetchium-problem-details/hub-invalid-login-challenge":
    "errors.expiredLoginChallenge",
  "vetchium-problem-details/hub-recent-authentication-required":
    "errors.recentAuthenticationRequired",
  "vetchium-problem-details/rate-limit-exceeded": "errors.rateLimited",
  "vetchium-problem-details/idempotency-key-conflict":
    "errors.idempotencyConflict",
  "vetchium-problem-details/hub-totp-already-enabled":
    "errors.totpAlreadyEnabled",
  "vetchium-problem-details/hub-totp-not-enabled": "errors.totpNotEnabled",
  "vetchium-problem-details/hub-invalid-totp-enrollment":
    "errors.invalidEnrollment",
};

export function APIErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error === null || error === undefined) return null;
  const key =
    error instanceof APIError && error.problem
      ? problemKeys[error.problem.type]
      : undefined;
  return <Alert type="error" showIcon title={t(key ?? "errors.generic")} />;
}
