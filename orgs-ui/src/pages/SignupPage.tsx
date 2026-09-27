import { useQuery } from "@tanstack/react-query";
import { frontendLocaleOptions } from "@vetchium/portal-ui/localization";
import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Select,
  Spin,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { countryCodeValues, isCountryCode } from "typespec/common/countries";
import type { OrgSignupRegion } from "typespec/regions/regions";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";
import {
  type FrontendLocale,
  isFrontendLocale,
  usePreferences,
} from "../app/preferences";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { SignupRequestForm } from "../features/signup/SignupRequestForm";

// Pages hold 50 regions, so this bounds discovery at 1000 regions.
const maxRegionPages = 20;

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

  const catalog = useQuery({
    queryKey: ["org-signup-regions", country],
    enabled: isCountryCode(country),
    retry: false,
    queryFn: async () => {
      const regions: OrgSignupRegion[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < maxRegionPages; page += 1) {
        const result = await orgsAPI.listSignupRegions({
          country,
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
    (region) => new URL(region.orgs_url).origin === window.location.origin,
  );
  const details = params.step === "details" && local !== undefined;
  const collator = new Intl.Collator(language);
  const countries = countryCodeValues
    .map((value) => ({ value, label: countryName(value, language) }))
    .sort((left, right) => collator.compare(left.label, right.label));

  function continueSignup() {
    if (!selected) return;
    const path = `${paths.signup}/${country}/${language}/details`;
    if (new URL(selected.orgs_url).origin === window.location.origin) {
      navigate(path);
      return;
    }
    window.location.assign(new URL(path, selected.orgs_url).href);
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
                region: countryName(local.hosting_country, language),
                tenant: local.tenant_id,
              })}
            />
            <SignupRequestForm />
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
                        region: countryName(region.hosting_country, language),
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
              {selected
                ? t("signup.continueRegion", {
                    region: countryName(selected.hosting_country, language),
                    tenant: selected.tenant_id,
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
