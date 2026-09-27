import { useMutation } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, Button, Card, Flex, Form, Input, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import {
  normalizeRequestPasswordResetRequest,
  type RequestPasswordResetRequest,
} from "typespec/orgs/auth/password";
import { isOrgDomain, normalizeOrgDomain } from "typespec/orgs/types";
import { isDefiniteRefusal } from "../api/client";
import { orgsAPI } from "../api/orgs";
import { loginPath } from "../app/paths";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const prefilledDomain = normalizeOrgDomain(searchParams.get("domain") ?? "");
  const key = useIdempotencyKey();
  const request = useMutation({
    mutationFn: (body: RequestPasswordResetRequest) =>
      orgsAPI.requestPasswordReset(body, key.current()),
    onSuccess: () => key.rotate(),
    onError: (error) => {
      if (isDefiniteRefusal(error)) key.rotate();
    },
  });
  return (
    <Card className="auth-card">
      <title>{t("forgotPassword.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <div>
          <Typography.Title level={1}>
            {t("forgotPassword.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("forgotPassword.description")}
          </Typography.Text>
        </div>
        {request.isSuccess ? (
          <div data-testid="forgot-password-sent">
            <Alert
              type="success"
              showIcon
              title={t("forgotPassword.checkEmail")}
            />
          </div>
        ) : (
          <>
            <APIErrorAlert error={request.error} />
            <Form<RequestPasswordResetRequest>
              layout="vertical"
              initialValues={{ domain: prefilledDomain }}
              onFinish={(values) =>
                request.mutate(normalizeRequestPasswordResetRequest(values))
              }
            >
              <Form.Item
                name="domain"
                label={t("fields.domain")}
                rules={[
                  { required: true, message: t("validation.required") },
                  {
                    validator: (_, value: string | undefined) =>
                      value === undefined ||
                      value === "" ||
                      isOrgDomain(normalizeOrgDomain(value))
                        ? Promise.resolve()
                        : Promise.reject(new Error(t("validation.domain"))),
                  },
                ]}
              >
                <Input
                  autoComplete="organization"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </Form.Item>
              <Form.Item
                name="email_address"
                label={t("fields.email")}
                rules={[
                  {
                    required: true,
                    type: "email",
                    message: t("validation.email"),
                  },
                ]}
              >
                <Input autoComplete="username" inputMode="email" />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={request.isPending}
              >
                {t("forgotPassword.action")}
              </Button>
            </Form>
          </>
        )}
        <Link
          to={loginPath(
            request.variables?.domain ??
              (isOrgDomain(prefilledDomain) ? prefilledDomain : undefined),
          )}
        >
          {t("common.backToSignIn")}
        </Link>
      </Flex>
    </Card>
  );
}
