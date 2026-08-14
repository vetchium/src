import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type { NewPassword } from "../../../typespec/common/authentication.ts";
import { completePasswordReset } from "../features/auth/api";

interface ResetForm {
  new_password: NewPassword;
  confirm_password: string;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const mutation = useMutation({ mutationFn: completePasswordReset });

  const submit = ({ new_password }: ResetForm) => {
    if (token !== null) {
      mutation.mutate({ reset_token: token, new_password });
    }
  };

  return (
    <Card className="auth-card">
      <title>{t("resetPassword.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <Typography.Title level={2}>
          {t("resetPassword.title")}
        </Typography.Title>
        {token === null ? (
          <Alert type="error" title={t("resetPassword.missingToken")} />
        ) : null}
        {mutation.isSuccess ? (
          <Alert type="success" title={t("resetPassword.success")} />
        ) : null}
        {mutation.isError ? (
          <Alert type="error" title={t("resetPassword.error")} />
        ) : null}
        {!mutation.isSuccess && token !== null ? (
          <Form<ResetForm> layout="vertical" onFinish={submit}>
            <Form.Item
              name="new_password"
              label={t("fields.newPassword")}
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
              dependencies={["new_password"]}
              rules={[
                { required: true, message: t("validation.required") },
                ({ getFieldValue }) => ({
                  validator: (_, value: string) =>
                    value === getFieldValue("new_password")
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
              {t("resetPassword.action")}
            </Button>
          </Form>
        ) : null}
        <Link to="/login">{t("common.backToLogin")}</Link>
      </Space>
    </Card>
  );
}
