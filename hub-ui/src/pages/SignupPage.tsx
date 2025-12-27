import { Layout, Card, Typography } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SignupRequestForm } from "../forms/SignupRequestForm";

const { Content } = Layout;
const { Title, Text } = Typography;

export function SignupPage() {
  const { t } = useTranslation("signup");

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
          <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
            {t("requestTitle")}
          </Title>

          <SignupRequestForm />

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
