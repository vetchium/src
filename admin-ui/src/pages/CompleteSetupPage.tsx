import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import {
  type CompleteSetupRequest,
  normalizeCompleteSetupRequest,
} from "typespec/admin/users/invitations";
import { isNewPassword } from "typespec/common/authentication";
import { isDisplayName } from "typespec/common/localization";
import { useIdempotencyKey } from "../api/idempotency";
import { problemTranslationKey } from "../api/problems";
import { usePendingOperations } from "../app/PendingOperationContext";
import { usePreferences } from "../app/PreferencesContext";
import { completeSetup } from "../features/auth/api";

interface SetupForm {
  password: string;
  confirm_password: string;
  display_name: string;
}

export function CompleteSetupPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  return (
    <Card className="auth-card setup-card">
      <title>{t("completeSetup.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={2}>
            {t("completeSetup.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("completeSetup.description")}
          </Typography.Text>
        </div>
        {token === null ? (
          <Alert type="error" title={t("completeSetup.missingToken")} />
        ) : (
          // Keyed on the invitation: everything below belongs to it, so a
          // different invitation starts from nothing rather than inheriting the
          // previous one's outcome, form values or key.
          <CompleteSetupOperation key={token} token={token} />
        )}
      </Space>
    </Card>
  );
}

function CompleteSetupOperation({ token }: { token: string }) {
  const { t } = useTranslation();
  const preferences = usePreferences();
  // Held across retries: setup consumes the invitation, so a retry after a lost
  // response must replay the account it already created rather than be told the
  // invitation is spent.
  const setupKey = useIdempotencyKey(`admin.setup.${token}`);
  const mutation = useMutation({
    mutationFn: (request: CompleteSetupRequest) =>
      completeSetup(request, setupKey.current()),
  });

  const { hold } = usePendingOperations();

  const submit = async (values: SetupForm) => {
    // The invitation is spent either way, so the report of what happened must
    // survive the user leaving this page.
    const release = hold();
    try {
      await mutation.mutateAsync(
        normalizeCompleteSetupRequest({
          invitation_token: token,
          password: values.password,
          display_name: values.display_name,
          preferred_language: preferences.language,
        }),
      );
    } catch {
    } finally {
      release();
    }
  };

  return (
    <>
      {mutation.isSuccess ? (
        <Alert type="success" title={t("completeSetup.success")} />
      ) : null}
      {mutation.isError ? (
        <Alert
          type="error"
          title={t(
            problemTranslationKey(mutation.error, {}, "completeSetup.error"),
          )}
        />
      ) : null}
      {mutation.isSuccess ? null : (
        <Form<SetupForm>
          layout="vertical"
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="display_name"
            label={t("fields.name")}
            extra={t("profile.nameHint")}
            rules={[
              { required: true, message: t("validation.required") },
              {
                validator: (_: unknown, value: string | undefined) =>
                  value === undefined || value === "" || isDisplayName(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("validation.displayName"))),
              },
            ]}
          >
            <Input autoComplete="name" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("fields.password")}
            rules={[
              { required: true, message: t("validation.required") },
              {
                validator: (_: unknown, value: string | undefined) =>
                  value === undefined || value === "" || isNewPassword(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("validation.newPassword"))),
              },
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={128} />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label={t("fields.confirmPassword")}
            dependencies={["password"]}
            rules={[
              { required: true, message: t("validation.required") },
              ({ getFieldValue }) => ({
                validator: (_, value: string) =>
                  value === getFieldValue("password")
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("validation.passwordMatch"))),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={128} />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={mutation.isPending}
          >
            {t("completeSetup.action")}
          </Button>
        </Form>
      )}
      {mutation.isSuccess ? (
        <Link
          to="/login"
          onClick={(event) => {
            if (mutation.isPending) {
              event.preventDefault();
              return;
            }
            // This link only renders on success, so reaching it means the
            // account creation has been presented and acknowledged.
            setupKey.rotate();
          }}
        >
          {t("completeSetup.signIn")}
        </Link>
      ) : null}
    </>
  );
}
