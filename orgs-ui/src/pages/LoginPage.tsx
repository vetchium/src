import { useMutation } from "@tanstack/react-query";
import { safeReturnTo } from "@vetchium/portal-ui/navigation";
import { usePendingOperations } from "@vetchium/portal-ui/pending-operations";
import {
  findRegion,
  regionFromSearchParams,
} from "@vetchium/portal-ui/region-selection";
import { Alert, App, Button, Card, Flex, Form, Input, Typography } from "antd";
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
import {
  InvalidCredentialsError,
  isHomedElsewhereProblem,
} from "typespec/problem/orgs/authentication";
import { APIError } from "../api/client";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";
import { regionTable } from "../app/regions";

import type { LoginAttempt } from "../auth/AuthContext";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import {
  RegionField,
  useSelectedRegion,
} from "../features/regions/RegionField";

function forgotPasswordPath(domain: string): string {
  const normalized = normalizeOrgDomain(domain);
  return isOrgDomain(normalized)
    ? `${paths.forgotPassword}?domain=${encodeURIComponent(normalized)}`
    : paths.forgotPassword;
}

/** Offers to switch the picker to the Org's home region, keeping what the
 * user entered, when that region is one this portal knows. */
function HomedElsewhere({
  error,
  domain,
  onSwitch,
}: {
  error: unknown;
  domain: string;
  onSwitch: (tenantId: string) => void;
}) {
  const { t } = useTranslation();
  const problem = error instanceof APIError ? error.problem : undefined;
  if (!isHomedElsewhereProblem(problem)) return null;
  const home = findRegion(regionTable, problem.tenant_id);
  return (
    <div data-testid="login-homed-elsewhere">
      <Alert
        type="info"
        showIcon
        title={t("login.homedElsewhere.title", { domain })}
        description={t("login.homedElsewhere.description")}
        action={
          home === undefined ? undefined : (
            <Button
              type="primary"
              size="small"
              onClick={() => onSwitch(home.tenantId)}
            >
              {t("login.homedElsewhere.action")}
            </Button>
          )
        }
      />
    </div>
  );
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
  const [region, setRegion] = useSelectedRegion(
    regionFromSearchParams(regionTable, searchParams),
  );
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

  const homedElsewhere =
    mutation.error instanceof APIError &&
    isHomedElsewhereProblem(mutation.error.problem);

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
        {homedElsewhere && mutation.variables !== undefined ? (
          <HomedElsewhere
            error={mutation.error}
            domain={normalizeOrgDomain(mutation.variables.request.domain)}
            onSwitch={(tenantId) => {
              mutation.reset();
              setRegion(tenantId);
            }}
          />
        ) : (
          <APIErrorAlert error={mutation.error} />
        )}
        {mutation.error instanceof APIError &&
          mutation.error.problem?.type === InvalidCredentialsError.type && (
            <Typography.Text type="secondary">
              {t("login.wrongRegionHint")}
            </Typography.Text>
          )}
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
