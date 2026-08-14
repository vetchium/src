import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Radio,
  Space,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import type {
  TOTPCode,
  TOTPRecoveryCode,
} from "../../../typespec/common/authentication.ts";
import { useAuth } from "../auth/AuthContext";
import { safeReturnTo } from "../auth/navigation";
import { verifyRecoveryCode, verifyTFA } from "../features/auth/api";

interface CodeForm {
  code: string;
}

export function TwoFactorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const mutation = useMutation({
    mutationFn: async ({ code }: CodeForm) => {
      const challenge = auth.pendingChallenge;
      if (challenge === null) {
        throw new Error("Missing login challenge");
      }
      if (method === "totp") {
        return verifyTFA({
          login_challenge_token: challenge.login_challenge_token,
          totp_code: code as TOTPCode,
        });
      }
      return verifyRecoveryCode({
        login_challenge_token: challenge.login_challenge_token,
        recovery_code: code as TOTPRecoveryCode,
      });
    },
  });

  if (auth.pendingChallenge === null) {
    return <Navigate replace to="/login" />;
  }

  const submit = async (values: CodeForm) => {
    const challenge = auth.pendingChallenge;
    if (
      challenge === null ||
      new Date(challenge.login_challenge_expires_at).getTime() <= Date.now()
    ) {
      auth.clearChallenge();
      navigate("/login", { replace: true });
      return;
    }
    const session = await mutation.mutateAsync(values);
    auth.completeAuthentication(session);
    navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
  };

  return (
    <Card className="auth-card">
      <title>{t("twoFactor.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={2}>{t("twoFactor.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("twoFactor.description")}
          </Typography.Text>
        </div>
        <Radio.Group
          block
          value={method}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: t("twoFactor.authenticator"), value: "totp" },
            { label: t("twoFactor.recovery"), value: "recovery" },
          ]}
          onChange={(event) =>
            setMethod(event.target.value as "totp" | "recovery")
          }
        />
        {mutation.isError ? (
          <Alert type="error" title={t("twoFactor.error")} />
        ) : null}
        <Form<CodeForm>
          layout="vertical"
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="code"
            label={
              method === "totp"
                ? t("fields.totpCode")
                : t("fields.recoveryCode")
            }
            rules={[
              { required: true, message: t("validation.required") },
              ...(method === "totp"
                ? [{ pattern: /^\d{6}$/, message: t("validation.totpCode") }]
                : []),
            ]}
          >
            <Input autoComplete="one-time-code" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={mutation.isPending}
          >
            {t("twoFactor.action")}
          </Button>
        </Form>
        <Button
          type="link"
          onClick={() => {
            auth.clearChallenge();
            navigate("/login");
          }}
        >
          {t("twoFactor.restart")}
        </Button>
      </Space>
    </Card>
  );
}
