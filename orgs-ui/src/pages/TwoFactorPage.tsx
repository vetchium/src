import { useMutation } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { safeReturnTo } from "@vetchium/portal-ui/navigation";
import { usePendingOperations } from "@vetchium/portal-ui/pending-operations";
import { App, Button, Card, Flex, Form, Input, Radio, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { isTOTPCode, isTOTPRecoveryCode } from "typespec/common/authentication";
import type { VerifyRecoveryCodeResponse } from "typespec/orgs/auth/totp";
import type { AuthenticatedSessionResponse } from "typespec/orgs/auth/types";
import { isDefiniteRefusal } from "../api/client";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

type Method = "totp" | "recovery";

interface CodeForm {
  code: string;
}

export function TwoFactorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const { message } = App.useApp();
  const [method, setMethod] = useState<Method>("totp");
  // Verifying consumes the login challenge, and a recovery code besides, so a
  // retry after a lost response has to replay the session it already issued
  // rather than spend a second code. Deliberately not persisted across
  // unmount: replay needs the identical request, and the code that went with
  // the key cannot be restored without storing the credential itself.
  const totpKey = useIdempotencyKey();
  const recoveryKey = useIdempotencyKey();
  const { hold, pending } = usePendingOperations();
  const mutation = useMutation({
    mutationFn: async ({
      code,
    }: CodeForm): Promise<
      AuthenticatedSessionResponse | VerifyRecoveryCodeResponse
    > => {
      const challenge = auth.pendingChallenge;
      if (challenge === null) throw new Error("Missing login challenge");
      if (method === "totp") {
        return orgsAPI.verifyTFA(
          {
            login_challenge_token: challenge.login_challenge_token,
            totp_code: code,
          },
          totpKey.current(),
        );
      }
      return orgsAPI.verifyRecoveryCode(
        {
          login_challenge_token: challenge.login_challenge_token,
          recovery_code: code.trim(),
        },
        recoveryKey.current(),
      );
    },
  });

  if (auth.pendingChallenge === null) {
    return <Navigate replace to={paths.login} />;
  }

  const submit = async (values: CodeForm) => {
    const challenge = auth.pendingChallenge;
    if (
      challenge === null ||
      new Date(challenge.login_challenge_expires_at).getTime() <= Date.now()
    ) {
      auth.clearChallenge();
      navigate(paths.login, { replace: true });
      return;
    }
    const release = hold();
    let session: Awaited<ReturnType<typeof mutation.mutateAsync>>;
    try {
      session = await mutation.mutateAsync(values);
    } catch (error) {
      // A refused code is finished; the next code is a new request.
      if (isDefiniteRefusal(error)) {
        totpKey.rotate();
        recoveryKey.rotate();
      }
      return;
    } finally {
      release();
    }
    // The user may have restarted, or begun a second sign-in, while this was
    // in flight. That flow now owns the portal, so this response is discarded.
    if (
      !auth.completeAuthentication(session, undefined, {
        challenge: challenge.login_challenge_token,
      })
    ) {
      return;
    }
    if ("remaining_recovery_codes" in session) {
      void message.warning(
        t("twoFactor.recoveryCodesLeft", {
          count: session.remaining_recovery_codes,
        }),
      );
    }
    navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
  };

  return (
    <Card className="auth-card">
      <title>{t("twoFactor.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <div>
          <Typography.Title level={1}>{t("twoFactor.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("twoFactor.description")}
          </Typography.Text>
        </div>
        <Radio.Group
          block
          value={method}
          optionType="button"
          buttonStyle="solid"
          aria-label={t("twoFactor.methodLabel")}
          options={[
            { label: t("twoFactor.authenticator"), value: "totp" },
            { label: t("twoFactor.recovery"), value: "recovery" },
          ]}
          onChange={(event) => {
            mutation.reset();
            setMethod(event.target.value as Method);
          }}
        />
        <APIErrorAlert error={mutation.error} />
        <Form<CodeForm>
          key={method}
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
              {
                validator: (_: unknown, value: string | undefined) =>
                  value === undefined ||
                  value === "" ||
                  (method === "totp"
                    ? isTOTPCode(value)
                    : isTOTPRecoveryCode(value.trim()))
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(
                          t(
                            method === "totp"
                              ? "validation.totpCode"
                              : "validation.recoveryCode",
                          ),
                        ),
                      ),
              },
            ]}
          >
            <Input
              autoFocus
              autoComplete="one-time-code"
              maxLength={method === "totp" ? 6 : 128}
              inputMode={method === "totp" ? "numeric" : "text"}
            />
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
        {/* Restarting while a verification is in flight would be overridden by
            its own result. */}
        <Button
          type="link"
          disabled={pending}
          onClick={() => {
            if (pending) return;
            auth.clearChallenge();
            navigate(paths.login);
          }}
        >
          {t("twoFactor.restart")}
        </Button>
      </Flex>
    </Card>
  );
}
