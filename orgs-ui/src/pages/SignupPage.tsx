import { Alert, Card, Flex, Select, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router";
import { paths } from "../app/paths";
import { usePreferences } from "../app/preferences";
import { regionTable } from "../app/regions";
import { useAuth } from "../auth/AuthContext";
import { SignupRequestForm } from "../features/signup/SignupRequestForm";

const orgSignupRegions = regionTable.regions.filter(
  (region) => region.orgSignupEnabled,
);

export function SignupPage() {
  const { authenticated } = useAuth();
  if (authenticated) return <Navigate replace to={paths.home} />;
  return <SignupFlow />;
}

function SignupFlow() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const [selectedTenant, setSelectedTenant] = useState<string>();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const language = preferences.language;

  const regionNames = new Intl.DisplayNames([language], { type: "region" });

  return (
    <Card className="setup-card">
      <title>{t("signup.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <div>
          <Typography.Title level={1}>{t("signup.title")}</Typography.Title>
          {!sent && (
            <>
              <Typography.Paragraph type="secondary">
                {t("signup.description")}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                {t("signup.requester")}
              </Typography.Paragraph>
            </>
          )}
        </div>
        {!sent &&
          (orgSignupRegions.length === 0 ? (
            <Alert type="info" showIcon title={t("signup.noRegions")} />
          ) : (
            <div>
              <Typography.Text strong>
                {t("signup.regionLabel")}
              </Typography.Text>
              <Typography.Paragraph type="secondary">
                {t("signup.regionDescription")}
              </Typography.Paragraph>
              <Select
                aria-label={t("signup.regionLabel")}
                placeholder={t("signup.selectRegion")}
                value={selectedTenant}
                disabled={submitting}
                options={orgSignupRegions.map((region) => ({
                  value: region.tenantId,
                  label: t("signup.regionOption", {
                    region:
                      regionNames.of(region.hostingCountry) ??
                      region.hostingCountry,
                    tenant: region.tenantId,
                  }),
                }))}
                onChange={setSelectedTenant}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        {orgSignupRegions.length > 0 && (
          <SignupRequestForm
            key={selectedTenant ?? "unselected"}
            tenantId={selectedTenant}
            onSent={() => setSent(true)}
            onSubmittingChange={setSubmitting}
          />
        )}
        <Typography.Text>
          {t("signup.haveAccount")}{" "}
          <Link to={paths.login}>{t("signup.signIn")}</Link>
        </Typography.Text>
      </Flex>
    </Card>
  );
}
