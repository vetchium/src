import { frontendLocaleOptions } from "@vetchium/portal-ui/localization";
import { regionFromSearchParams } from "@vetchium/portal-ui/region-selection";
import { Alert, Button, Card, Flex, Form, Select, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { countryCodeValues, isCountryCode } from "typespec/common/countries";
import type { CountryCode } from "typespec/common/localization";
import { paths } from "../app/paths";
import {
  type FrontendLocale,
  isFrontendLocale,
  usePreferences,
} from "../app/preferences";
import { regionTable } from "../app/regions";
import { useAuth } from "../auth/AuthContext";
import { SignupRequestForm } from "../features/signup/SignupRequestForm";

/** Regions accepting Org signup. allowedCountries is Hub residency policy,
 * so an Org's country only selects the recommendation: the country's, else
 * the default, else the first region accepting Org signup. */
const orgSignupRegions = regionTable.regions.filter(
  (region) => region.orgSignupEnabled,
);

function recommendedRegion(country: string): string | undefined {
  const preferred =
    regionTable.recommendations[country as CountryCode] ??
    regionTable.defaultTenant;
  return (
    orgSignupRegions.find((region) => region.tenantId === preferred) ??
    orgSignupRegions[0]
  )?.tenantId;
}

function countryName(country: string, locale: FrontendLocale): string {
  return (
    new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country
  );
}

export function SignupPage() {
  const params = useParams();
  const { authenticated } = useAuth();
  if (authenticated) return <Navigate replace to={paths.home} />;
  return (
    <SignupFlow
      key={`${params.country ?? ""}/${params.language ?? ""}/${params.step ?? ""}`}
    />
  );
}

function SignupFlow() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const params = useParams();
  const navigate = useNavigate();
  const [country, setCountry] = useState(
    isCountryCode(params.country ?? "") ? (params.country ?? "") : "",
  );
  const [selectedTenant, setSelectedTenant] = useState<string>();
  const language = preferences.language;

  // A region picked in another tenant's portal carries the visitor's
  // language here, so the emails and the rest of signup use it.
  useEffect(() => {
    if (isFrontendLocale(params.language) && params.language !== language) {
      preferences.setLanguage(params.language);
    }
  }, [params.language, language, preferences]);

  const [search] = useSearchParams();
  const options = isCountryCode(country) ? orgSignupRegions : [];
  const recommended = recommendedRegion(country);
  const selected =
    options.find((region) => region.tenantId === selectedTenant) ??
    options.find((region) => region.tenantId === recommended) ??
    options[0];
  const destinationTenant = regionFromSearchParams(regionTable, search);
  const destination = orgSignupRegions.find(
    (region) => region.tenantId === destinationTenant,
  );
  const details = params.step === "details" && destination !== undefined;
  const collator = new Intl.Collator(language);
  const countries = countryCodeValues
    .map((value) => ({ value, label: countryName(value, language) }))
    .sort((left, right) => collator.compare(left.label, right.label));

  function continueSignup() {
    if (!selected) return;
    const query = new URLSearchParams({ region: selected.tenantId });
    navigate(`${paths.signup}/${country}/${language}/details?${query}`);
  }

  return (
    <Card className="setup-card">
      <title>{t("signup.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <div>
          <Typography.Title level={1}>{t("signup.title")}</Typography.Title>
          <Typography.Paragraph type="secondary">
            {t(details ? "signup.description" : "signup.regionDescription")}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            {t("signup.requester")}
          </Typography.Paragraph>
        </div>
        {details ? (
          <>
            <Alert
              type="info"
              showIcon
              data-testid="signup-region"
              title={t("signup.hosting", {
                region: countryName(destination.hostingCountry, language),
                tenant: destination.tenantId,
              })}
            />
            <SignupRequestForm tenantId={destination.tenantId} />
            <Button onClick={() => navigate(`${paths.signup}/${country}`)}>
              {t("signup.changeRegion")}
            </Button>
          </>
        ) : (
          <Form layout="vertical" onFinish={continueSignup}>
            <Form.Item label={t("signup.country")} required>
              <Select
                aria-label={t("signup.country")}
                showSearch={{ optionFilterProp: "label" }}
                value={country || undefined}
                options={countries}
                onChange={(value: string) => {
                  setCountry(value);
                  setSelectedTenant(undefined);
                }}
              />
            </Form.Item>
            <Form.Item label={t("signup.language")} required>
              <Select
                aria-label={t("signup.language")}
                value={language}
                options={frontendLocaleOptions(preferences.supportedLocales)}
                onChange={(value: FrontendLocale) =>
                  preferences.setLanguage(value)
                }
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
                        region: countryName(region.hostingCountry, language),
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
                    region: countryName(selected.hostingCountry, language),
                    tenant: selected.tenantId,
                  })
                : t("signup.continue")}
            </Button>
          </Form>
        )}
        <Typography.Text>
          {t("signup.haveAccount")}{" "}
          <Link to={paths.login}>{t("signup.signIn")}</Link>
        </Typography.Text>
      </Flex>
    </Card>
  );
}
