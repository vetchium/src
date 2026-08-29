import { ChangePasswordCard as SharedChangePasswordCard } from "@vetchium/portal-ui/security";
import { isNewPassword } from "typespec/common/authentication";
import { isRecentAuthenticationRequired } from "../../api/client";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { changePassword } from "./api";

export function ChangePasswordCard() {
  return (
    <SharedChangePasswordCard
      changePassword={(newPassword) =>
        changePassword({ new_password: newPassword })
      }
      validPassword={isNewPassword}
      isRecentAuthenticationRequired={isRecentAuthenticationRequired}
      reauthenticationAlert={<ReauthenticationAlert />}
      problemKeys={{}}
      fallbackProblemKey="common.requestError"
      translations={{
        title: "security.password.card",
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
