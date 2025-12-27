import { Layout, Card, Typography, Alert } from "antd";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SignupCompleteForm } from "../forms/SignupCompleteForm";

const { Content } = Layout;
const { Title, Text } = Typography;

export function SignupVerifyPage() {
  const { t } = useTranslation("signup");
  const [searchParams] = useSearchParams();
  const signupToken = searchParams.get("token");

  if (!signupToken) {
    return (
      <Layout style={{ minHeight: "100vh" }}>
        <Content
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Card style={{ width: 500 }}>
            <Alert
              message={t("invalidToken")}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <div style={{ textAlign: "center" }}>
              <Text>
                <Link to="/signup">{t("signupLink")}</Link>
              </Text>
            </div>
          </Card>
        </Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Content
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "24px",
        }}
      >
        <Card style={{ width: 600 }}>
          <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
            {t("completeTitle")}
          </Title>

          <SignupCompleteForm signupToken={signupToken} />

          <div style={{ textAlign: "center", marginTop: 16 }}>
            <Text>
              <Link to="/login">{t("loginLink")}</Link>
            </Text>
          </div>
        </Card>
      </Content>
    </Layout>
  );
}
