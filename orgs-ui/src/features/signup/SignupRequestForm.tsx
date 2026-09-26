import { useMutation } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, Button, Flex, Form, Input, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { EmailAddress } from "typespec/common/common";
import {
  normalizeRequestSignupRequest,
  type RequestSignupRequest,
  signupDomain,
  validateRequestSignupRequest,
} from "typespec/orgs/auth/signup";
import { isDefiniteRefusal } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { usePreferences } from "../../app/preferences";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";

interface RequestValues {
  email_address: EmailAddress;
}

function isValidSignupEmail(email: string, request: RequestSignupRequest) {
  return !validateRequestSignupRequest({
    ...request,
    email_address: email,
  }).includes("email_address");
}

/** Asks for the DNS instructions and the private signup link. Region choice,
 * once discovery exists for Orgs, happens before this form. */
export function SignupRequestForm() {
  const { t } = useTranslation();
  const { language } = usePreferences();
  const [form] = Form.useForm<RequestValues>();
  const email = Form.useWatch("email_address", form) ?? "";
  const key = useIdempotencyKey();
  const signup = useMutation({
    mutationFn: (request: RequestSignupRequest) =>
      orgsAPI.requestSignup(request, key.current()),
    onSuccess: () => key.rotate(),
    onError: (error) => {
      if (isDefiniteRefusal(error)) key.rotate();
    },
  });
  const draft: RequestSignupRequest = {
    email_address: email,
    preferred_language: language,
  };
  const derivedDomain = isValidSignupEmail(email, draft)
    ? signupDomain(email)
    : null;

  if (signup.isSuccess && signup.variables !== undefined) {
    const sent = signup.variables;
    return (
      <Flex orientation="vertical" gap="middle" data-testid="signup-sent">
        <Alert
          type="success"
          showIcon
          title={t("signup.sent.title")}
          description={t("signup.sent.description", {
            email: sent.email_address,
          })}
        />
        <Typography.Paragraph>
          <Typography.Text strong>{t("signup.sent.dnsTitle")}</Typography.Text>{" "}
          {t("signup.sent.dnsBody", {
            domain: signupDomain(sent.email_address),
          })}
        </Typography.Paragraph>
        <Typography.Paragraph>
          <Typography.Text strong>{t("signup.sent.linkTitle")}</Typography.Text>{" "}
          {t("signup.sent.linkBody")}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          {t("signup.sent.next")}
        </Typography.Paragraph>
        <div>
          <Button
            onClick={() => {
              signup.reset();
              form.resetFields();
            }}
          >
            {t("signup.sent.again")}
          </Button>
        </div>
      </Flex>
    );
  }

  return (
    <Flex orientation="vertical" gap="middle">
      <APIErrorAlert error={signup.error} />
      <Form<RequestValues>
        form={form}
        layout="vertical"
        onFinish={(values) =>
          signup.mutate(
            normalizeRequestSignupRequest({
              email_address: values.email_address,
              preferred_language: language,
            }),
          )
        }
      >
        <Form.Item
          name="email_address"
          label={t("fields.workEmail")}
          extra={
            derivedDomain === null ? (
              t("signup.emailHelp")
            ) : (
              <span data-testid="signup-domain">
                {t("signup.derivedDomain", { domain: derivedDomain })}
              </span>
            )
          }
          rules={[
            { required: true, message: t("validation.required") },
            {
              validator: (_, value: string | undefined) =>
                value === undefined ||
                value === "" ||
                isValidSignupEmail(value, draft)
                  ? Promise.resolve()
                  : Promise.reject(new Error(t("validation.workEmail"))),
            },
          ]}
        >
          <Input autoComplete="email" inputMode="email" autoFocus />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={signup.isPending}
        >
          {t("signup.action")}
        </Button>
      </Form>
    </Flex>
  );
}
