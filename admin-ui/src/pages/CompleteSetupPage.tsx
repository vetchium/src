import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type { RegionalLanguageCode } from "../../../typespec/common/localization.ts";
import { usePreferences } from "../app/PreferencesContext";
import { completeSetup } from "../features/auth/api";

interface SetupForm {
  password: string;
  confirm_password: string;
  display_name: string;
  display_name_language: RegionalLanguageCode;
}

export function CompleteSetupPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const preferences = usePreferences();
  const mutation = useMutation({ mutationFn: completeSetup });

  const submit = (values: SetupForm) => {
    if (token === null) return;
    mutation.mutate({
      invitation_token: token,
      password: values.password,
      display_names: [
        {
          language_code: values.display_name_language,
          display_name: values.display_name,
        },
      ],
      primary_display_name_language: values.display_name_language,
      preferred_language: preferences.language,
    });
  };

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
        ) : null}
        {mutation.isSuccess ? (
          <Alert type="success" title={t("completeSetup.success")} />
        ) : null}
        {mutation.isError ? (
          <Alert type="error" title={t("completeSetup.error")} />
        ) : null}
        {!mutation.isSuccess && token !== null ? (
          <Form<SetupForm>
            layout="vertical"
            onFinish={submit}
            initialValues={{
              display_name_language:
                preferences.language === "ta"
                  ? "ta-IN"
                  : preferences.language === "de_DE"
                    ? "de-DE"
                    : "en-US",
            }}
          >
            <Form.Item
              name="display_name"
              label={t("fields.displayName")}
              rules={[{ required: true, message: t("validation.required") }]}
            >
              <Input autoComplete="name" maxLength={200} />
            </Form.Item>
            <Form.Item
              name="display_name_language"
              label={t("fields.languageCode")}
              rules={[
                {
                  required: true,
                  pattern: /^[a-z]{2}-[A-Z]{2}$/,
                  message: t("validation.languageCode"),
                },
              ]}
            >
              <Input placeholder={t("profile.languageCodePlaceholder")} />
            </Form.Item>
            <Form.Item
              name="password"
              label={t("fields.password")}
              rules={[
                {
                  required: true,
                  min: 15,
                  message: t("validation.newPassword"),
                },
              ]}
            >
              <Input.Password autoComplete="new-password" />
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
                      : Promise.reject(
                          new Error(t("validation.passwordMatch")),
                        ),
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
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
        ) : null}
        {mutation.isSuccess ? (
          <Link to="/login">{t("completeSetup.signIn")}</Link>
        ) : null}
      </Space>
    </Card>
  );
}
