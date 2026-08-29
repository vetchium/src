import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import {
  type CompletePasswordResetRequest,
  validateCompletePasswordResetRequest,
} from "typespec/admin/auth/password";
import type { NewPassword } from "typespec/common/authentication";
import { useIdempotencyKey } from "../api/idempotency";
import { problemTranslationKey } from "../api/problems";
import { usePendingOperations } from "../app/PendingOperationContext";
import { completePasswordReset } from "../features/auth/api";

interface ResetForm {
  new_password: NewPassword;
  confirm_password: string;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  return (
    <Card className="auth-card">
      <title>{t("resetPassword.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <Typography.Title level={1}>
          {t("resetPassword.title")}
        </Typography.Title>
        {token === null ? (
          <Alert type="error" title={t("resetPassword.missingToken")} />
        ) : (
          // Keyed on the token: everything below belongs to it, so a different
          // token starts from nothing rather than inheriting the previous
          // operation's outcome, form values or key.
          <ResetPasswordOperation key={token} token={token} />
        )}
      </Space>
    </Card>
  );
}

function ResetPasswordOperation({ token }: { token: string }) {
  const { t } = useTranslation();
  // Held across retries: the reset consumes the token, so a retry after a lost
  // response must replay the committed result rather than be told the token is
  // spent.
  const resetKey = useIdempotencyKey(`admin.reset.${token}`);
  const mutation = useMutation({
    mutationFn: (request: CompletePasswordResetRequest) =>
      completePasswordReset(request, resetKey.current()),
  });
  const { hold } = usePendingOperations();
  const queryClient = useQueryClient();

  const submit = async ({ new_password }: ResetForm) => {
    // The hold outlives this page: the token is spent either way, and leaving
    // before the response lands would destroy the only report of that.
    const release = hold();
    try {
      await mutation.mutateAsync({ reset_token: token, new_password });
      // The reset token is opaque: it may belong to the administrator signed in
      // here, whose sessions the server has just revoked, or to someone else
      // entirely. Rather than guess, drop everything cached under the current
      // session so the next request establishes which it was — succeeding, or
      // answering 401 and tearing the session down through the usual path.
      queryClient.clear();
    } catch {
    } finally {
      release();
    }
  };

  return (
    <>
      {mutation.isSuccess ? (
        <Alert type="success" title={t("resetPassword.success")} />
      ) : null}
      {mutation.isError ? (
        <Alert
          type="error"
          title={t(
            problemTranslationKey(mutation.error, {}, "resetPassword.error"),
          )}
        />
      ) : null}
      {mutation.isSuccess ? null : (
        <Form<ResetForm>
          layout="vertical"
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="new_password"
            label={t("fields.newPassword")}
            rules={[
              { required: true, message: t("validation.required") },
              {
                validator: (_: unknown, value: string | undefined) =>
                  value === undefined ||
                  value === "" ||
                  !validateCompletePasswordResetRequest({
                    reset_token: token,
                    new_password: value,
                  }).includes("new_password")
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
            dependencies={["new_password"]}
            rules={[
              { required: true, message: t("validation.required") },
              ({ getFieldValue }) => ({
                validator: (_, value: string) =>
                  value === getFieldValue("new_password")
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
            {t("resetPassword.action")}
          </Button>
        </Form>
      )}
      <Link
        to="/login"
        onClick={(event) => {
          if (mutation.isPending) {
            event.preventDefault();
            return;
          }
          // Leaving a success the user has actually been shown is what
          // finishes the operation. Forgetting the key any earlier would
          // strand a result that history navigation could still return to.
          if (mutation.isSuccess) {
            resetKey.rotate();
          }
        }}
      >
        {t("common.backToLogin")}
      </Link>
    </>
  );
}
