import { useMutation } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  Button,
  Flex,
  Form,
  Input,
  Space,
  Steps,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  normalizeRequestSignupRequest,
  type RequestSignupRequest,
  signupDomain,
  validateRequestSignupRequest,
} from "typespec/orgs/auth/signup";
import {
  isOrgDomain,
  isSpecialUseDomain,
  normalizeOrgDomain,
} from "typespec/orgs/types";
import { isDefiniteRefusal } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { usePreferences } from "../../app/preferences";
import { orgRegionSettings } from "../../app/regions";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";

interface RequestValues {
  domain: string;
  local_part: string;
}

const localPartID = "signup-local-part";

/** Asks the chosen region for the DNS instructions and the private signup
 * link. The domain comes first and fixes the address's domain, because the
 * signup claims exactly the address's domain. */
export function SignupRequestForm({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const { language } = usePreferences();
  const { allowSpecialUseDomains } = orgRegionSettings(tenantId);
  const [form] = Form.useForm<RequestValues>();
  const admittedDomain = (value: string): string | null => {
    const normalized = normalizeOrgDomain(value);
    return isOrgDomain(normalized) &&
      (allowSpecialUseDomains || !isSpecialUseDomain(normalized))
      ? normalized
      : null;
  };
  const domain = admittedDomain(Form.useWatch("domain", form) ?? "");
  const key = useIdempotencyKey();
  const signup = useMutation({
    mutationFn: (request: RequestSignupRequest) =>
      orgsAPI.requestSignup(request, key.current(), tenantId),
    onSuccess: () => key.rotate(),
    onError: (error) => {
      if (isDefiniteRefusal(error)) key.rotate();
    },
  });

  const request = (values: RequestValues): RequestSignupRequest =>
    normalizeRequestSignupRequest({
      email_address: `${values.local_part.trim()}@${normalizeOrgDomain(values.domain)}`,
      preferred_language: language,
    });

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
      </Flex>
    );
  }

  const shownDomain = domain ?? t("signup.steps.yourDomain");
  return (
    <Flex orientation="vertical" gap="middle">
      <APIErrorAlert error={signup.error} />
      <Form<RequestValues>
        form={form}
        layout="vertical"
        onFinish={(values) => signup.mutate(request(values))}
      >
        <Form.Item
          name="domain"
          label={t("fields.domain")}
          extra={t("signup.domainHelp")}
          rules={[
            { required: true, message: t("validation.required") },
            {
              validator: (_, value: string | undefined) => {
                if (value === undefined || value === "") {
                  return Promise.resolve();
                }
                if (admittedDomain(value) !== null) return Promise.resolve();
                return Promise.reject(
                  new Error(
                    t(
                      isOrgDomain(normalizeOrgDomain(value))
                        ? "validation.specialUseDomain"
                        : "validation.domain",
                    ),
                  ),
                );
              },
            },
          ]}
        >
          <Input autoComplete="off" inputMode="url" autoFocus />
        </Form.Item>
        <Form.Item
          label={t("signup.emailLabel")}
          htmlFor={localPartID}
          required
          extra={t("signup.emailHelp")}
        >
          <Space.Compact block>
            <Form.Item
              name="local_part"
              noStyle
              dependencies={["domain"]}
              rules={[
                { required: true, message: t("validation.required") },
                ({ getFieldValue }) => ({
                  validator: (_, value: string | undefined) => {
                    if (value === undefined || value === "") {
                      return Promise.resolve();
                    }
                    if (value.includes("@")) {
                      return Promise.reject(
                        new Error(t("validation.localPart")),
                      );
                    }
                    // Dependency revalidation runs before this component
                    // re-renders, so read the domain from the form.
                    const current = admittedDomain(
                      String(getFieldValue("domain") ?? ""),
                    );
                    // An invalid domain is reported on its own field.
                    if (current === null) return Promise.resolve();
                    const fields = validateRequestSignupRequest(
                      request({ domain: current, local_part: value }),
                    );
                    return fields.includes("email_address")
                      ? Promise.reject(new Error(t("validation.email")))
                      : Promise.resolve();
                  },
                }),
              ]}
            >
              <Input
                id={localPartID}
                autoComplete="off"
                disabled={domain === null}
              />
            </Form.Item>
            <Space.Addon data-testid="signup-email-domain">
              @{shownDomain}
            </Space.Addon>
          </Space.Compact>
        </Form.Item>
        <Typography.Paragraph strong>
          {t("signup.steps.title")}
        </Typography.Paragraph>
        <div data-testid="signup-steps">
          <Steps
            orientation="vertical"
            size="small"
            items={[
              {
                status: "wait",
                title: t("signup.steps.emails.title"),
                content: t("signup.steps.emails.content", {
                  domain: shownDomain,
                }),
              },
              {
                status: "wait",
                title: t("signup.steps.record.title"),
                content: t("signup.steps.record.content", {
                  domain: shownDomain,
                }),
              },
              {
                status: "wait",
                title: t("signup.steps.complete.title"),
                content: t("signup.steps.complete.content"),
              },
            ]}
          />
        </div>
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
