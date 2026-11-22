import { useMutation, useQuery } from "@tanstack/react-query";
import { localized } from "@vetchium/portal-ui/localized";
import {
  findRegion,
  regionFromSearchParams,
} from "@vetchium/portal-ui/region-selection";
import { Alert, Button, Card, Flex, Form, Input, Spin, Typography } from "antd";
import { useEffect, useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { isNewPassword } from "typespec/common/authentication";
import { validateGetSignupDetailsRequest } from "typespec/hub/auth/signup";
import { IdempotencyKeyConflictError } from "typespec/problem/common";
import {
  InvalidSignupTokenError,
  isHubAccountHomedElsewhereProblem,
  SignupDomainNotAllowedError,
  SignupUnavailableError,
} from "typespec/problem/hub/signup";
import { APIError, isProblem } from "../api/client";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { usePendingOperations } from "../app/PendingOperationContext";
import { usePreferences } from "../app/PreferencesContext";
import { regionStore, regionTable } from "../app/regions";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { FieldLabel } from "../components/common/FieldLabel";
import { regionName } from "../features/regions/names";
import { countryName } from "../i18n/countries";

interface AccountValues {
  emailAddress: string;
  password: string;
}

function HomedElsewhere({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const problem = error instanceof APIError ? error.problem : undefined;
  if (!isHubAccountHomedElsewhereProblem(problem)) return null;
  return (
    <div data-testid="complete-signup-homed-elsewhere">
      <Alert
        type="info"
        showIcon
        title={t("completeSignup.homedElsewhere.title", {
          region: countryName(problem.hosting_country, preferences.language),
        })}
        description={t("completeSignup.homedElsewhere.description")}
        action={
          <Link
            to={
              findRegion(regionTable, problem.tenant_id) === undefined
                ? "/login"
                : `/login?${new URLSearchParams({ region: problem.tenant_id })}`
            }
          >
            {t("completeSignup.homedElsewhere.action")}
          </Link>
        }
      />
    </div>
  );
}

export function CompleteSignupPage() {
  const { t } = useTranslation();
  const { language } = usePreferences();
  const auth = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";
  const region =
    findRegion(regionTable, regionFromSearchParams(regionTable, search)) ??
    null;
  const key = useIdempotencyKey(`hub-complete-signup:${token}`);
  const { hold } = usePendingOperations();
  const passwordID = useId();
  // The link is spent once the account exists: from then on only sign in.
  const [created, setCreated] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const linkComplete =
    region !== null &&
    validateGetSignupDetailsRequest({ signup_token: token }).length === 0;
  // Reading again once completion starts would find the link spent.
  const details = useQuery({
    queryKey: ["hub", "signup-details", region?.tenantId, token],
    queryFn: () =>
      hubAPI.getSignupDetails({ signup_token: token }, region?.tenantId ?? ""),
    enabled: linkComplete && !created,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnReconnect: false,
  });

  const finish = useMutation({
    mutationFn: async (values: AccountValues) => {
      if (region === null) return null;
      const { tenantId } = region;
      const release = hold();
      try {
        if (!created) {
          const result = await hubAPI.completeSignup(
            { signup_token: token, password: values.password },
            key.current(),
            tenantId,
          );
          if (!("handle" in result)) {
            setWaiting(true);
            return null;
          }
          key.rotate();
          regionStore.remember(tenantId);
          setCreated(true);
        }
        setWaiting(false);
        const attempt = auth.beginAttempt();
        const response = await hubAPI.login(
          {
            email_address: values.emailAddress,
            password: values.password,
            remember_me: false,
          },
          tenantId,
        );
        return { response, attempt, tenantId };
      } finally {
        release();
      }
    },
    onError: () => setWaiting(false),
    onSuccess: (result) => {
      if (result === null) return;
      const { response, attempt, tenantId } = result;
      const metadata = { remembered: false, tenantId };
      if (response.authentication_state === "totp_required") {
        if (auth.beginChallenge(response, metadata, attempt)) {
          navigate("/login/two-factor", { replace: true });
        }
      } else if (auth.completeAuthentication(response, metadata, { attempt })) {
        navigate("/", { replace: true });
      }
    },
  });

  const { isSuccess, mutate, variables } = finish;
  useEffect(() => {
    if (!waiting || !isSuccess || variables === undefined) return;
    const timer = window.setTimeout(() => mutate(variables), 2000);
    return () => window.clearTimeout(timer);
  }, [waiting, isSuccess, mutate, variables]);

  const homedElsewhere = isHubAccountHomedElsewhereProblem(
    finish.error instanceof APIError ? finish.error.problem : undefined,
  );
  const emailAddress = variables?.emailAddress ?? details.data?.email_address;
  const error = finish.error ?? details.error;
  const spent = !created && isProblem(error, InvalidSignupTokenError.type);
  const signupRefused =
    !created &&
    (isProblem(finish.error, SignupDomainNotAllowedError.type) ||
      isProblem(finish.error, SignupUnavailableError.type));

  return (
    <Card className="auth-card">
      <title>{t("completeSignup.documentTitle")}</title>
      <Flex vertical gap="middle">
        <div>
          <Typography.Title level={1} style={{ marginTop: 0 }}>
            {t(
              spent || !linkComplete
                ? "completeSignup.deadLinkTitle"
                : "completeSignup.title",
            )}
          </Typography.Title>
          {!linkComplete ||
          region === null ||
          emailAddress === undefined ||
          spent ||
          homedElsewhere ? null : (
            <Flex vertical gap={4}>
              <Typography.Text style={{ overflowWrap: "anywhere" }}>
                {created ? (
                  <strong>{emailAddress}</strong>
                ) : (
                  <Trans
                    i18nKey="completeSignup.creatingFor"
                    values={{ email: emailAddress }}
                    components={{ strong: <strong /> }}
                  />
                )}
              </Typography.Text>
              {created ? null : (
                <Typography.Text type="secondary">
                  {t("completeSignup.description", {
                    region: regionName(t, region, language),
                  })}
                </Typography.Text>
              )}
            </Flex>
          )}
        </div>
        {!linkComplete ? (
          // A truncated link must say so. A form whose submit
          // button is disabled explains nothing.
          <Alert
            type="error"
            showIcon
            title={t("completeSignup.missingToken")}
          />
        ) : homedElsewhere ? (
          <HomedElsewhere error={finish.error} />
        ) : spent ? (
          <>
            <APIErrorAlert error={error} />
            <Link to="/login">{t("common.backToSignin")}</Link>
            <Link to="/signup">{t("completeSignup.startAgain")}</Link>
          </>
        ) : emailAddress === undefined ? (
          details.isError ? (
            <>
              <APIErrorAlert error={details.error} />
              <Button
                loading={details.isFetching}
                onClick={() => void details.refetch()}
              >
                {t("common.retry")}
              </Button>
            </>
          ) : (
            <Spin aria-label={t("completeSignup.loading")} />
          )
        ) : (
          <>
            {waiting ? (
              <Alert type="info" showIcon title={t("completeSignup.pending")} />
            ) : null}
            {created ? (
              <Alert
                type="success"
                showIcon
                title={t("completeSignup.created")}
              />
            ) : null}
            {!created &&
            isProblem(finish.error, IdempotencyKeyConflictError.type) ? (
              // The generic advice, to reload, cannot help: a reload replays
              // the same key.
              <Alert
                type="error"
                showIcon
                title={t("completeSignup.passwordChanged")}
              />
            ) : (
              <APIErrorAlert error={finish.error} />
            )}
            {signupRefused ? (
              <Link to="/signup">{t("completeSignup.startAgain")}</Link>
            ) : null}
            <div hidden={waiting}>
              <Form<Pick<AccountValues, "password">>
                layout="vertical"
                scrollToFirstError={{ focus: true }}
                onFinish={(values) => {
                  if (!finish.isPending) {
                    finish.mutate({ emailAddress, password: values.password });
                  }
                }}
              >
                {/* Tells password managers which account to save. */}
                <input
                  type="email"
                  autoComplete="username"
                  value={emailAddress}
                  readOnly
                  hidden
                />
                <FieldLabel htmlFor={passwordID} label={t("fields.password")} />
                <Form.Item
                  name="password"
                  required
                  validateTrigger="onSubmit"
                  extra={created ? undefined : t("completeSignup.passwordRule")}
                  rules={[
                    {
                      validator: async (_, value: string | undefined) => {
                        if (!isNewPassword(value ?? "")) {
                          throw localized("validation.newPassword");
                        }
                      },
                    },
                  ]}
                >
                  <Input.Password
                    id={passwordID}
                    autoFocus
                    readOnly={created}
                    autoComplete="new-password"
                  />
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  loading={finish.isPending}
                >
                  {t(created ? "login.action" : "completeSignup.action")}
                </Button>
              </Form>
            </div>
            {created ? (
              <Link to="/login">{t("common.continueToSignin")}</Link>
            ) : null}
          </>
        )}
      </Flex>
    </Card>
  );
}
