import { useMutation } from "@tanstack/react-query";
import { fieldErrors, localized } from "@vetchium/portal-ui/localized";
import {
  Button,
  Card,
  Flex,
  Form,
  Input,
  type InputRef,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { isEmailAddress } from "typespec/common/common";
import { isDisplayName } from "typespec/common/localization";
import {
  normalizeRequestSignupRequest,
  type RequestSignupRequest,
} from "typespec/hub/auth/signup";
import {
  SignupDomainNotAllowedError,
  SignupUnavailableError,
} from "typespec/problem/hub/signup";
import { isProblem } from "../api/client";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { usePreferences } from "../app/PreferencesContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { FieldLabel } from "../components/common/FieldLabel";
import { regionNameOf } from "../features/regions/names";
import { CheckEmail } from "../features/signup/CheckEmail";
import { RegionChoice } from "../features/signup/RegionChoice";
import { eligibleRegions, recommendedRegion } from "../features/signup/regions";
import { countryOptions } from "../i18n/countries";

type SignupValues = Pick<
  RequestSignupRequest,
  "display_name" | "email_address" | "resident_country"
>;

interface Submission {
  values: SignupValues;
  tenantId: string;
}

export function SignupPage() {
  const { t } = useTranslation();
  const { language } = usePreferences();
  const [form] = Form.useForm<SignupValues>();
  const nameID = useId();
  const emailID = useId();
  const countryID = useId();
  const emailInput = useRef<InputRef>(null);
  const country = Form.useWatch("resident_country", form);
  const [chosen, setChosen] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const [sent, setSent] = useState<Submission>();
  const [resent, setResent] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);

  const options = eligibleRegions(country);
  const recommended = recommendedRegion(country);
  const selected =
    options.find((region) => region.tenantId === chosen) ??
    recommended ??
    options[0];

  const signup = useMutation({
    mutationFn: ({ values, tenantId }: Submission) => {
      // The header's language when sent is the language of the email.
      const request = normalizeRequestSignupRequest({
        ...values,
        preferred_language: language,
      });
      const payload = JSON.stringify([request, tenantId]);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.requestSignup(request, key.current(), tenantId);
    },
    onSuccess: (_, submission) => {
      key.rotate();
      lastPayload.current = null;
      setResent(sent !== undefined);
      setSent(submission);
    },
    onError: (error) => {
      if (sent !== undefined) return;
      if (isProblem(error, SignupUnavailableError.type)) setChoosing(true);
      if (!isProblem(error, SignupDomainNotAllowedError.type)) return;
      form.setFields([
        {
          name: "email_address",
          errors: fieldErrors(localized("errors.signupDomainNotAllowed")),
        },
      ]);
      emailInput.current?.focus();
    },
  });

  useEffect(() => {
    if (!editingEmail) return;
    emailInput.current?.focus({ cursor: "all" });
    setEditingEmail(false);
  }, [editingEmail]);

  const refusedEmail = isProblem(
    signup.error,
    SignupDomainNotAllowedError.type,
  );

  return (
    <Card className="auth-card">
      <title>{t("signup.documentTitle")}</title>
      {sent === undefined ? null : (
        <CheckEmail
          email={sent.values.email_address.trim()}
          region={regionNameOf(t, sent.tenantId, language)}
          resending={signup.isPending}
          resent={resent && !signup.isPending && !signup.isError}
          error={signup.error}
          onResend={() => signup.mutate(sent)}
          onDifferentEmail={() => {
            setSent(undefined);
            setResent(false);
            signup.reset();
            setEditingEmail(true);
          }}
        />
      )}
      {/* Kept mounted so "Use a different email" finds what was typed. */}
      <div hidden={sent !== undefined}>
        <Flex vertical gap="middle">
          <div>
            <Typography.Title level={1} style={{ marginTop: 0 }}>
              {t("signup.title")}
            </Typography.Title>
            <Typography.Text type="secondary">
              {t("signup.description")}
            </Typography.Text>
          </div>
          <Form<SignupValues>
            form={form}
            layout="vertical"
            scrollToFirstError={{ focus: true }}
            onFinish={(values) => {
              if (selected === undefined || signup.isPending) return;
              signup.mutate({ values, tenantId: selected.tenantId });
            }}
          >
            <FieldLabel
              htmlFor={nameID}
              label={t("signup.name")}
              help={t("signup.nameHelp")}
            />
            <Form.Item
              name="display_name"
              required
              rules={[
                {
                  validator: async (_, value: string | undefined) => {
                    if (!isDisplayName((value ?? "").trim())) {
                      throw localized("validation.displayName");
                    }
                  },
                },
              ]}
            >
              <Input id={nameID} autoComplete="name" />
            </Form.Item>
            <FieldLabel
              htmlFor={emailID}
              label={t("signup.email")}
              help={t("signup.emailHelp")}
            />
            <Form.Item
              name="email_address"
              required
              validateTrigger="onSubmit"
              rules={[
                {
                  validator: async (_, value: string | undefined) => {
                    if (!isEmailAddress((value ?? "").trim())) {
                      throw localized("validation.email");
                    }
                  },
                },
              ]}
            >
              <Input
                id={emailID}
                ref={emailInput}
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                onChange={() => {
                  // A refusal is about the address that was sent.
                  form.setFields([{ name: "email_address", errors: [] }]);
                }}
              />
            </Form.Item>
            <FieldLabel
              htmlFor={countryID}
              label={t("signup.country")}
              help={t("signup.countryHelp")}
            />
            <Form.Item
              name="resident_country"
              required
              rules={[
                {
                  validator: async (_, value: string | undefined) => {
                    if (value === undefined) {
                      throw localized("validation.country");
                    }
                    if (eligibleRegions(value).length === 0) {
                      throw localized("signup.noRegions");
                    }
                  },
                },
              ]}
            >
              <Select
                id={countryID}
                showSearch={{ optionFilterProp: "label" }}
                placeholder={t("signup.countryPlaceholder")}
                options={countryOptions(language)}
                onChange={() => {
                  setChosen(undefined);
                  setChoosing(false);
                }}
              />
            </Form.Item>
            <Space orientation="vertical" size="middle" className="full-width">
              {selected === undefined ? null : (
                <RegionChoice
                  options={options}
                  selected={selected}
                  recommended={recommended}
                  choosing={choosing}
                  disabled={signup.isPending}
                  onChangeRequested={() => setChoosing(true)}
                  onSelect={setChosen}
                />
              )}
              {refusedEmail ? null : <APIErrorAlert error={signup.error} />}
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={signup.isPending}
              >
                {t("signup.action")}
              </Button>
            </Space>
          </Form>
          <Link to="/terms">{t("signup.terms")}</Link>
          <Typography.Text>
            {t("signup.haveAccount")}{" "}
            <Link to="/login">{t("signup.signin")}</Link>
          </Typography.Text>
        </Flex>
      </div>
    </Card>
  );
}
