import { ChangePasswordCard as SharedChangePasswordCard } from "@vetchium/portal-ui/security";
import { ReauthenticationAlert } from "@vetchium/portal-ui/shell";
import { isNewPassword } from "typespec/common/authentication";
import { isRecentAuthenticationRequired } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import {
  fallbackProblemKey,
  problemKeys,
} from "../../components/common/APIErrorAlert";

export function ChangePasswordCard() {
  return (
    <SharedChangePasswordCard
      changePassword={(newPassword) =>
        orgsAPI.changePassword({ new_password: newPassword })
      }
      validPassword={isNewPassword}
      isRecentAuthenticationRequired={isRecentAuthenticationRequired}
      reauthenticationAlert={<ReauthenticationAlert />}
      problemKeys={problemKeys}
      fallbackProblemKey={fallbackProblemKey}
      translations={{
        title: "security.password.title",
        description: "security.password.description",
        success: "security.password.changed",
        action: "security.password.action",
        newPassword: "fields.newPassword",
        confirmPassword: "fields.confirmPassword",
        passwordMismatch: "validation.passwordMatch",
        invalidPassword: "validation.newPassword",
        required: "validation.required",
      }}
    />
  );
}
