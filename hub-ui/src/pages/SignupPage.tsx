import { useMutation } from "@tanstack/react-query";
import { frontendLocaleOptions } from "@vetchium/portal-ui/localization";
import { regionFromSearchParams } from "@vetchium/portal-ui/region-selection";
import type { PortalRegion } from "@vetchium/portal-ui/regions";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { isCountryCode } from "typespec/common/countries";
import type { CountryCode } from "typespec/common/localization";
import type { RequestSignupRequest } from "typespec/hub/auth/signup";
import { type FrontendLocale, isFrontendLocale } from "typespec/hub/types";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { usePreferences } from "../app/PreferencesContext";
import { regionTable } from "../app/regions";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { countryName, countryOptions } from "../i18n/countries";

/** Regions accepting Hub signup from residents of `country`. The destination
 * region still decides admission; this only avoids offering a region whose
 * compiled-in policy would refuse. */
function eligibleRegions(country: string): readonly PortalRegion[] {
  if (!isCountryCode(country)) return [];
  return regionTable.regions.filter(
    (region) =>
      region.signupEnabled &&
      (region.allowedCountries.length === 0 ||
        region.allowedCountries.includes(country)),
  );
}

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
  const [search] = useSearchParams();
  const key = useIdempotencyKey();
  const options = eligibleRegions(country);
  const recommended =
    regionTable.recommendations[country as CountryCode] ?? undefined;
  const selected =
    options.find((region) => region.tenantId === selectedTenant) ??
    options.find((region) => region.tenantId === recommended) ??
    options[0];
  const destinationTenant = regionFromSearchParams(regionTable, search);
  const destination = options.find(
    (region) => region.tenantId === destinationTenant,
  );
  const details = params.step === "details" && destination !== undefined;
  const signup = useMutation({
    mutationFn: (
      values: Pick<RequestSignupRequest, "display_name" | "email_address">,
    ) =>
      hubAPI.requestSignup(
        { ...values, preferred_language: language, resident_country: country },
        key.current(),
        destination?.tenantId ?? "",
      ),
    onSuccess: () => key.rotate(),
  });
  function continueSignup() {
    if (!selected) return;
    const query = new URLSearchParams({ region: selected.tenantId });
    navigate(`/signup/${country}/${language}/details?${query}`);
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
                  destination.hostingCountry,
                  preferences.language,
                ),
                tenant: destination.tenantId,
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
                options={frontendLocaleOptions(preferences.supportedLocales)}
                onChange={(value: FrontendLocale) => {
                  setLanguage(value);
                  preferences.setLanguage(value);
                }}
              />
            </Form.Item>
            {isCountryCode(country) && options.length === 0 && (
              <Alert type="info" title={t("signup.noRegions")} />
            )}
            {options.length > 0 && (
              <Form.Item label={t("signup.regionLabel")} required>
                <Select
                  aria-label={t("signup.regionLabel")}
                  value={selected?.tenantId}
                  options={options.map((region) => ({
                    value: region.tenantId,
                    label: t(
                      region.tenantId === recommended
                        ? "signup.recommendedRegion"
                        : "signup.regionOption",
                      {
                        region: countryName(
                          region.hostingCountry,
                          preferences.language,
                        ),
                        tenant: region.tenantId,
                      },
                    ),
                  }))}
                  onChange={setSelectedTenant}
                />
              </Form.Item>
            )}
            <Button type="primary" htmlType="submit" block disabled={!selected}>
              {selected
                ? t("signup.continueRegion", {
                    region: countryName(
                      selected.hostingCountry,
                      preferences.language,
                    ),
                    tenant: selected.tenantId,
                  })
                : t("common.continue")}
            </Button>
          </Form>
        )}
        {!signup.isSuccess && (
          <>
            <Typography.Text>
              {t("signup.haveAccount")}{" "}
              <Link to="/login">{t("signup.signin")}</Link>
            </Typography.Text>
            <Typography.Text>
              <Link to="/terms">{t("signup.terms")}</Link>
            </Typography.Text>
          </>
        )}
      </Space>
    </Card>
  );
}
