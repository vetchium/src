import { useMutation } from "@tanstack/react-query";
import { safeReturnTo } from "@vetchium/portal-ui/navigation";
import { usePendingOperations } from "@vetchium/portal-ui/pending-operations";
import { useExplicitRegionSelection } from "@vetchium/portal-ui/region-picker";
import { App, Button, Card, Flex, Form, Input, Typography } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { LoginRequest } from "typespec/orgs/auth/login";
import {
  AuthenticationStateTOTPRequired,
  normalizeLoginRequest,
  validateLoginRequest,
} from "typespec/orgs/auth/login";
import { isOrgDomain, normalizeOrgDomain } from "typespec/orgs/types";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";

import type { LoginAttempt } from "../auth/AuthContext";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { RegionField } from "../features/regions/RegionField";

function forgotPasswordPath(domain: string): string {
  const normalized = normalizeOrgDomain(domain);
  return isOrgDomain(normalized)
    ? `${paths.forgotPassword}?domain=${encodeURIComponent(normalized)}`
    : paths.forgotPassword;
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const prefilledDomain = normalizeOrgDomain(searchParams.get("domain") ?? "");
  const mutation = useMutation({
    mutationFn: ({
      request,
      tenantId,
    }: {
      request: LoginRequest;
      tenantId: string;
    }) => orgsAPI.login(request, tenantId),
  });
  const [region, setRegion] = useExplicitRegionSelection();
  const [form] = Form.useForm<LoginRequest>();
  const enteredDomain = Form.useWatch("domain", form) ?? "";
  const { message } = App.useApp();
  // A verification in flight still owns the challenge it is about to spend.
  // Superseding it from here would make the server consume that code for a
  // result this client then refuses.
  const { pending } = usePendingOperations();
  const supersedingBlocked = () => {
    if (!pending) return false;
    void message.warning(t("shell.operationInProgress"));
    return true;
  };
  // Leaving the page abandons an attempt whose response has not been handed
  // off, so it cannot install a session or a challenge behind the user's back.
  const unhandedAttempt = useRef<LoginAttempt | null>(null);
  const authRef = useRef(auth);
  authRef.current = auth;
  useEffect(
    () => () => {
      if (unhandedAttempt.current !== null) authRef.current.clearChallenge();
    },
    [],
  );

  if (auth.authenticated) return <Navigate replace to={returnTo} />;

  const submit = async (values: LoginRequest) => {
    if (supersedingBlocked()) return;
    const request = normalizeLoginRequest(values);
    if (validateLoginRequest(request).length !== 0) return;
    // The region the request is sent to also issues the session, so it is
    // captured once rather than re-read after the response.
    if (region === undefined) return;
    const tenantId = region;
    // Claimed before the request so that a response arriving after the user
    // has started another sign-in is discarded rather than replacing it.
    const attempt = auth.beginAttempt();
    unhandedAttempt.current = attempt;
    let response: Awaited<ReturnType<typeof orgsAPI.login>>;
    try {
      response = await mutation.mutateAsync({ request, tenantId });
    } catch {
      return;
    }
    if (response.authentication_state === AuthenticationStateTOTPRequired) {
      if (!auth.beginChallenge(response, { tenantId }, attempt)) return;
      unhandedAttempt.current = null;
      navigate(`${paths.twoFactor}?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    if (!auth.completeAuthentication(response, { tenantId }, { attempt })) {
      return;
    }
    unhandedAttempt.current = null;
    navigate(returnTo, { replace: true });
  };

  return (
    <Card className="auth-card">
      <title>{t("login.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <div>
          <Typography.Title level={1}>{t("login.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("login.description")}
          </Typography.Text>
        </div>
        <APIErrorAlert error={mutation.error} />
        <Form<LoginRequest>
          form={form}
          layout="vertical"
          initialValues={{ domain: prefilledDomain }}
          onFinish={(values) => void submit(values)}
        >
          <RegionField
            value={region}
            onChange={(value) => {
              mutation.reset();
              setRegion(value);
            }}
            disabled={mutation.isPending}
          />
          <Form.Item
            name="domain"
            label={t("fields.domain")}
            extra={t("login.domainHelp")}
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
              autoFocus={prefilledDomain === ""}
            />
          </Form.Item>
          <Form.Item
            name="email_address"
            label={t("fields.email")}
            rules={[
              { required: true, type: "email", message: t("validation.email") },
            ]}
          >
            <Input
              autoComplete="username"
              inputMode="email"
              autoFocus={prefilledDomain !== ""}
            />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("fields.password")}
            rules={[{ required: true, message: t("validation.required") }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            disabled={region === undefined}
            loading={mutation.isPending}
          >
            {t("login.action")}
          </Button>
        </Form>
        <Flex orientation="vertical" gap="small">
          {/* Leaving for a password reset abandons the sign-in, so a response
              still in flight cannot pull the user back into it. */}
          <Link
            to={forgotPasswordPath(enteredDomain)}
            onClick={(event) => {
              if (supersedingBlocked()) {
                event.preventDefault();
                return;
              }
              auth.clearChallenge();
            }}
          >
            {t("login.forgotPassword")}
          </Link>
          <Typography.Text>
            {t("login.noAccount")}{" "}
            <Link to={paths.signup}>{t("login.signUp")}</Link>
          </Typography.Text>
        </Flex>
      </Flex>
    </Card>
  );
}
