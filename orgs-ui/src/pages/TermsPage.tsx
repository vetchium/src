import { Alert, Card, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { currentTermsVersion } from "typespec/orgs/auth/signup";

const sections = ["service", "accounts", "openings", "changes"] as const;

export function TermsPage() {
  const { t } = useTranslation();
  return (
    <Card className="setup-card">
      <title>{t("terms.documentTitle")}</title>
      <Flex orientation="vertical" gap="middle">
        <div>
          <Typography.Title level={1}>{t("terms.title")}</Typography.Title>
          <Typography.Text type="secondary" data-testid="terms-version">
            {t("terms.version", { version: currentTermsVersion })}
          </Typography.Text>
        </div>
        <Alert type="warning" showIcon title={t("terms.placeholder")} />
        {sections.map((section) => (
          <section key={section}>
            <Typography.Title level={2}>
              {t(`terms.sections.${section}.title`)}
            </Typography.Title>
            <Typography.Paragraph>
              {t(`terms.sections.${section}.body`)}
            </Typography.Paragraph>
          </section>
        ))}
      </Flex>
    </Card>
  );
}
