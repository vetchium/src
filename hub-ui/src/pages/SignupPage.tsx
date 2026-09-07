import { useMutation, useQuery } from "@tanstack/react-query";
import { frontendLocaleOptions } from "@vetchium/portal-ui/localization";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { isCountryCode } from "typespec/common/countries";
import {
  type FrontendLocale,
  isFrontendLocale,
} from "typespec/common/localization";
import type { RequestSignupRequest } from "typespec/hub/auth/signup";
import type { SignupRegion } from "typespec/regions/regions";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { usePreferences } from "../app/PreferencesContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { countryName, countryOptions } from "../i18n/countries";

// Pages hold 50 regions, so this bounds discovery at 1000 regions.
const maxRegionPages = 20;

export function SignupPage() {
  const params = useParams();
  return (
    <SignupFlow
      key={`${params.residentCountry ?? ""}/${params.language ?? ""}/${params.step ?? ""}`}
    />
  );
}

function SignupFlow() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const countries = countryOptions(preferences.language);
  const params = useParams();
  const navigate = useNavigate();
  const [country, setCountry] = useState(
    isCountryCode(params.residentCountry ?? "")
      ? (params.residentCountry ?? "")
      : "",
  );
  const [language, setLanguage] = useState<FrontendLocale>(
    isFrontendLocale(params.language) ? params.language : preferences.language,
  );
  const [selectedTenant, setSelectedTenant] = useState<string>();
  const key = useIdempotencyKey();
  const catalog = useQuery({
    queryKey: ["signup-regions", country],
    enabled: isCountryCode(country),
    retry: false,
    queryFn: async () => {
      const regions: SignupRegion[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      // A repeated cursor catches a server that loops; the page cap also stops
      // one that hands out an unbounded chain of fresh cursors.
      for (let page = 0; page < maxRegionPages; page += 1) {
        const result = await hubAPI.listSignupRegions({
          resident_country: country,
          pagination_key: cursor,
        });
        regions.push(...result.regions);
        cursor = result.next_pagination_key ?? undefined;
        if (!cursor) return regions;
        if (seen.has(cursor)) throw new Error("Repeated region cursor");
        seen.add(cursor);
      }
      throw new Error("Too many region pages");
    },
  });
  const options = catalog.data ?? [];
  const selected =
    options.find((region) => region.tenant_id === selectedTenant) ??
    options.find((region) => region.recommended) ??
    options[0];
  const local = options.find(
    (region) => new URL(region.hub_url).origin === window.location.origin,
  );
  const details = params.step === "details" && local !== undefined;
  const signup = useMutation({
    mutationFn: (
      values: Pick<RequestSignupRequest, "display_name" | "email_address">,
    ) =>
      hubAPI.requestSignup(
        { ...values, preferred_language: language, resident_country: country },
        key.current(),
      ),
    onSuccess: () => key.rotate(),
  });
  function continueSignup() {
    if (!selected) return;
    const path = `/signup/${country}/${language}/details`;
    if (new URL(selected.hub_url).origin === window.location.origin) {
      navigate(path);
      return;
    }
    window.location.assign(new URL(path, selected.hub_url).href);
  }
  return (
    <Card className="auth-card">
      <title>{t("signup.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={1}>{t("signup.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t(details ? "signup.description" : "signup.regionDescription")}
          </Typography.Text>
        </div>
        {signup.isSuccess ? (
          <>
            <Alert type="success" showIcon title={t("signup.checkEmail")} />
            <Link to="/login">{t("common.backToSignin")}</Link>
          </>
        ) : details ? (
          <>
            <Alert
              type="info"
              showIcon
              title={t("signup.hosting", {
                region: countryName(
                  local.hosting_country,
                  preferences.language,
                ),
                tenant: local.tenant_id,
              })}
            />
            <Typography.Text>
              {t("signup.residence", {
                country: countryName(country, preferences.language),
              })}
            </Typography.Text>
            <APIErrorAlert error={signup.error} />
            <Form<Pick<RequestSignupRequest, "display_name" | "email_address">>
              layout="vertical"
              onFinish={(values) => signup.mutate(values)}
            >
              <Form.Item
                name="display_name"
                label={t("fields.displayName")}
                rules={[
                  {
                    required: true,
                    max: 200,
                    message: t("validation.displayName"),
                  },
                ]}
              >
                <Input autoComplete="name" maxLength={200} />
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
                <Input autoComplete="email" />
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
            <Button
              disabled={signup.isPending}
              onClick={() => {
                signup.reset();
                key.rotate();
                navigate(`/signup/${country}/${language}`);
              }}
            >
              {t("signup.changeRegion")}
            </Button>
          </>
        ) : (
          <Form layout="vertical" onFinish={continueSignup}>
            <Form.Item label={t("fields.residentCountry")} required>
              <Select
                aria-label={t("fields.residentCountry")}
                showSearch={{ optionFilterProp: "label" }}
                value={country || undefined}
                options={countries}
                onChange={(value: string) => {
                  setCountry(value);
                  setSelectedTenant(undefined);
                }}
              />
            </Form.Item>
            <Form.Item label={t("fields.language")} required>
              <Select
                aria-label={`* ${t("fields.language")}`}
                value={language}
                options={frontendLocaleOptions()}
                onChange={(value: FrontendLocale) => {
                  setLanguage(value);
                  preferences.setLanguage(value);
                }}
              />
            </Form.Item>
            <APIErrorAlert error={catalog.error} />
            {catalog.isFetching && <Spin />}
            {catalog.isError && (
              <Button onClick={() => void catalog.refetch()}>
                {t("signup.retryRegions")}
              </Button>
            )}
            {catalog.isSuccess && options.length === 0 && (
              <Alert type="info" title={t("signup.noRegions")} />
            )}
            {options.length > 0 && (
              <Form.Item label={t("signup.regionLabel")} required>
                <Select
                  aria-label={t("signup.regionLabel")}
                  value={selected?.tenant_id}
                  options={options.map((region) => ({
                    value: region.tenant_id,
                    label: t(
                      region.recommended
                        ? "signup.recommendedRegion"
                        : "signup.regionOption",
                      {
                        region: countryName(
                          region.hosting_country,
                          preferences.language,
                        ),
                        tenant: region.tenant_id,
                      },
                    ),
                  }))}
                  onChange={setSelectedTenant}
                />
              </Form.Item>
            )}
            <Button
              type="primary"
              htmlType="submit"
              block
              disabled={!selected || catalog.isFetching || catalog.isError}
            >
              {t("signup.continueRegion")}
            </Button>
          </Form>
        )}
        {!signup.isSuccess && (
          <Typography.Text>
            {t("signup.haveAccount")}{" "}
            <Link to="/login">{t("signup.signin")}</Link>
          </Typography.Text>
        )}
      </Space>
    </Card>
  );
}
