import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";

export function LoginPage() {
  const { t } = useTranslation();

  return (
    <Card className="auth-card">
      <title>{t("login.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={1}>{t("login.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("login.description")}
          </Typography.Text>
        </div>
        <Alert type="info" showIcon description={t("login.notAvailable")} />
        <Form layout="vertical" disabled>
          <Form.Item name="email_address" label={t("fields.email")}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item name="password" label={t("fields.password")}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t("login.action")}
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
