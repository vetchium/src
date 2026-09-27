import { useMutation, useQuery } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { useHoldNavigation } from "@vetchium/portal-ui/pending-operations";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Form,
  Input,
  Spin,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { isNewPassword } from "typespec/common/authentication";
import type { IdempotencyKey } from "typespec/common/idempotency";
import { isDisplayName } from "typespec/common/localization";
import {
  type CompleteSignupRequest,
  normalizeCompleteSignupRequest,
  validateCompleteSignupRequest,
  validateGetSignupDetailsRequest,
} from "typespec/orgs/auth/signup";
import {
  DomainAlreadyOwnedError,
  InvalidSignupTokenError,
} from "typespec/problem/orgs/signup";
import { getProblemType, isDefiniteRefusal } from "../api/client";
import { orgsAPI } from "../api/orgs";
import { loginPath, paths } from "../app/paths";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { useDateTimeFormat } from "../components/common/useDateTimeFormat";
import { DnsRecord } from "../features/domain/DnsRecord";

interface CompleteValues {
  org_display_name: string;
  password: string;
  confirm_password: string;
}

interface Submission {
  request: CompleteSignupRequest;
  idempotencyKey: IdempotencyKey;
}

// A 202 means the global claim outcome is not known yet and a recovery worker
// is finishing it. Replaying the identical request with the same key returns
// the final result once there is one; the backoff keeps that polling bounded.
const pendingRetryDelays = [1000, 2000, 4000, 8000, 15000, 30000, 30000];

// Failures after which this signup link can no longer succeed, so the form is
// replaced by a way to start over.
const terminalProblems = new Set<string>([
  InvalidSignupTokenError.type,
  DomainAlreadyOwnedError.type,
]);

function predicateRule(valid: (value: string) => boolean, message: string) {
  return {
    validator: (_: unknown, value: string | undefined) =>
      value === undefined || value === "" || valid(value)
        ? Promise.resolve()
        : Promise.reject(new Error(message)),
  };
}

export function CompleteSignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const formatDateTime = useDateTimeFormat();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";
  const tokenPresent =
    validateGetSignupDetailsRequest({ signup_token: token }).length === 0;
  // Persisted per link so that a reload during an unresolved completion
  // replays the same request instead of starting a second one.
  const key = useIdempotencyKey(`orgs-complete-signup:${token}`);
  const [pendingAttempts, setPendingAttempts] = useState(0);
  const [awaitingResult, setAwaitingResult] = useState(false);

  const details = useQuery({
    queryKey: ["orgs", "signup-details", token],
    queryFn: () => orgsAPI.getSignupDetails({ signup_token: token }),
    enabled: tokenPresent,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const complete = useMutation({
    mutationFn: ({ request, idempotencyKey }: Submission) =>
      orgsAPI.completeSignup(request, idempotencyKey),
    onSuccess: (result) => {
      setAwaitingResult("operation_id" in result);
      if ("domain" in result) {
        key.rotate();
        void message.success(t("completeSignup.success"));
        navigate(loginPath(result.domain), { replace: true });
      }
    },
    onError: (error) => {
      setAwaitingResult(false);
      if (isDefiniteRefusal(error)) key.rotate();
    },
  });

  const { mutate, variables: submitted, isPending } = complete;
  const retriesExhausted = pendingAttempts >= pendingRetryDelays.length;
  useHoldNavigation(isPending || awaitingResult);

  useEffect(() => {
    if (!awaitingResult || isPending || retriesExhausted) return;
    if (submitted === undefined) return;
    const timer = window.setTimeout(() => {
      setPendingAttempts((attempts) => attempts + 1);
      mutate(submitted);
    }, pendingRetryDelays[pendingAttempts]);
    return () => window.clearTimeout(timer);
  }, [
    awaitingResult,
    isPending,
    retriesExhausted,
    pendingAttempts,
    mutate,
    submitted,
  ]);

  const submit = (values: CompleteValues) => {
    const request = normalizeCompleteSignupRequest({
      signup_token: token,
      org_display_name: values.org_display_name,
      password: values.password,
    });
    if (validateCompleteSignupRequest(request).length !== 0) return;
    setPendingAttempts(0);
    setAwaitingResult(false);
    mutate({ request, idempotencyKey: key.current() });
  };

  const checkAgain = () => {
    if (submitted === undefined) return;
    setPendingAttempts(0);
    mutate(submitted);
  };

  const problem = getProblemType(complete.error ?? details.error);
  const linkUnusable = problem !== undefined && terminalProblems.has(problem);

  return (
    <Card className="setup-card">
      <title>{t("completeSignup.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <Typography.Title level={1}>
          {t("completeSignup.title")}
        </Typography.Title>
        {!tokenPresent ? (
          // A truncated link must say so. A form whose submit button is
          // disabled explains nothing.
          <>
            <Alert
              type="error"
              showIcon
              title={t("completeSignup.missingToken")}
            />
            <Link to={paths.signup}>{t("completeSignup.startOver")}</Link>
          </>
        ) : details.isPending ? (
          <Flex justify="center">
            <Spin aria-label={t("common.loading")} />
          </Flex>
        ) : details.isError ? (
          <>
            <APIErrorAlert error={details.error} />
            {linkUnusable ? (
              <Link to={paths.signup}>{t("completeSignup.startOver")}</Link>
            ) : (
              <div>
                <Button onClick={() => void details.refetch()}>
                  {t("common.retry")}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <Flex orientation="vertical" gap="middle">
              <Typography.Paragraph>
                {t("completeSignup.instructions", {
                  domain: details.data.domain,
                })}
              </Typography.Paragraph>
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: "domain",
                    label: t("fields.domain"),
                    children: (
                      <Typography.Text strong data-testid="signup-domain">
                        {details.data.domain}
                      </Typography.Text>
                    ),
                  },
                  {
                    key: "expires",
                    label: t("completeSignup.expires"),
                    children: (
                      <span data-testid="signup-expires">
                        {formatDateTime(details.data.expires_at)}
                      </span>
                    ),
                  },
                ]}
              />
              <DnsRecord
                name={details.data.dns_record_name}
                value={details.data.dns_record_value}
              />
            </Flex>
            {awaitingResult ? (
              <div data-testid="complete-signup-pending">
                <Alert
                  type="info"
                  showIcon
                  icon={retriesExhausted ? undefined : <Spin size="small" />}
                  title={t(
                    retriesExhausted
                      ? "completeSignup.stillPending"
                      : "completeSignup.pending",
                  )}
                  action={
                    retriesExhausted ? (
                      <Button
                        size="small"
                        loading={isPending}
                        onClick={checkAgain}
                      >
                        {t("completeSignup.checkAgain")}
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <APIErrorAlert error={complete.error} />
            )}
            {linkUnusable ? (
              <Link to={paths.signup}>{t("completeSignup.startOver")}</Link>
            ) : (
              <Form<CompleteValues>
                layout="vertical"
                disabled={awaitingResult}
                onFinish={submit}
              >
                <Form.Item
                  name="org_display_name"
                  label={t("fields.orgDisplayName")}
                  extra={t("completeSignup.displayNameHelp")}
                  rules={[
                    { required: true, message: t("validation.required") },
                    predicateRule(isDisplayName, t("validation.displayName")),
                  ]}
                >
                  <Input autoComplete="organization" maxLength={200} />
                </Form.Item>
                <Form.Item
                  name="password"
                  label={t("fields.newPassword")}
                  rules={[
                    { required: true, message: t("validation.required") },
                    predicateRule(isNewPassword, t("validation.newPassword")),
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
                      validator: (_, value: string | undefined) =>
                        value === undefined ||
                        value === "" ||
                        value === getFieldValue("password")
                          ? Promise.resolve()
                          : Promise.reject(
                              new Error(t("validation.passwordMatch")),
                            ),
                    }),
                  ]}
                >
                  <Input.Password autoComplete="new-password" maxLength={128} />
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={isPending}
                >
                  {t("completeSignup.action")}
                </Button>
              </Form>
            )}
          </>
        )}
      </Flex>
    </Card>
  );
}
