import { ChangePasswordCard as SharedChangePasswordCard } from "@vetchium/portal-ui/security";
import { isNewPassword } from "typespec/common/authentication";
import { isRecentAuthenticationRequired } from "../../api/client";
import { hubAPI } from "../../api/hub";
import { problemKeys } from "../../components/common/APIErrorAlert";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";

export function ChangePasswordCard() {
  return (
    <SharedChangePasswordCard
      changePassword={(newPassword) =>
        hubAPI.changePassword({ new_password: newPassword })
      }
      validPassword={isNewPassword}
      isRecentAuthenticationRequired={isRecentAuthenticationRequired}
      reauthenticationAlert={<ReauthenticationAlert />}
      problemKeys={problemKeys}
      fallbackProblemKey="errors.generic"
      translations={{
        title: "passwordChange.title",
        description: "passwordChange.description",
        success: "passwordChange.success",
        action: "passwordChange.action",
        newPassword: "fields.newPassword",
        confirmPassword: "fields.confirmPassword",
        passwordMismatch: "validation.passwordMatch",
        invalidPassword: "validation.newPassword",
        required: "validation.required",
      }}
    />
  );
}
