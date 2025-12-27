import { useState } from "react";
import { Layout, Card, Form, Input, Button, Typography, Alert } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  type HubLoginRequest,
  validateHubLoginRequest,
} from "vetchium-specs/hub/hub-users";
import {
  EMAIL_MIN_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "vetchium-specs/common/common";
import * as api from "../lib/api-client";
import { useAuth } from "../contexts/AuthContext";

const { Content } = Layout;
const { Title, Text } = Typography;

export function LoginPage() {
  const { t } = useTranslation(["common", "signup"]);
  const navigate = useNavigate();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);

    const loginRequest: HubLoginRequest = {
      email_address: values.email,
      password: values.password,
    };

    // Validate using shared validation logic
    const validationErrors = validateHubLoginRequest(loginRequest);
    if (validationErrors.length > 0) {
      setError(validationErrors.map((e) => `${e.field}: ${e.message}`).join(", "));
      setLoading(false);
      return;
    }

    try {
      const response = await api.login(values.email, values.password);

      if (response.status === 400) {
        const errors = response.errors;
        if (errors && Array.isArray(errors)) {
          setError(errors.map((e) => `${e.field}: ${e.message}`).join(", "));
        } else {
          setError(t("common:invalidEmail"));
        }
        return;
      }

      if (response.status === 401) {
        setError("Invalid credentials");
        return;
      }

      if (response.status === 422) {
        setError("Account is not in a valid state to login");
        return;
      }

      if (response.status !== 200 || !response.data) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Login successful
      login(response.data.session_token);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Content
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Card style={{ width: 400 }}>
          <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
            Vetchium Hub
          </Title>

          <Form
            name="login"
            onFinish={onFinish}
            layout="vertical"
            requiredMark={false}
          >
            {error && (
              <Alert
                message={error}
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <Form.Item
              name="email"
              validateFirst
              rules={[
                { required: true, message: "Please enter your email" },
                { type: "email", message: "Please enter a valid email" },
                {
                  min: EMAIL_MIN_LENGTH,
                  message: `Email must be at least ${EMAIL_MIN_LENGTH} characters`,
                },
                {
                  max: EMAIL_MAX_LENGTH,
                  message: `Email must be at most ${EMAIL_MAX_LENGTH} characters`,
                },
              ]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="Email"
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="password"
              validateFirst
              rules={[
                { required: true, message: "Please enter your password" },
                {
                  min: PASSWORD_MIN_LENGTH,
                  message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
                },
                {
                  max: PASSWORD_MAX_LENGTH,
                  message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
                },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Password"
                size="large"
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
              >
                Login
              </Button>
            </Form.Item>
          </Form>

          <div style={{ textAlign: "center", marginTop: 16 }}>
            <Text>
              <Link to="/signup">{t("signup:signupLink")}</Link>
            </Text>
          </div>
        </Card>
      </Content>
    </Layout>
  );
}
