import { useState } from 'react'
import {
  ConfigProvider,
  Layout,
  Card,
  Form,
  Input,
  Button,
  Typography,
  Alert,
  theme,
} from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import {
  type HubLoginRequest,
  type HubLoginResponse,
  validateHubLoginRequest,
} from 'vetchium-specs/hub/hub-users'
import {
  EMAIL_MIN_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from 'vetchium-specs/common/common'
import { getApiBaseUrl } from './config'

const { Content } = Layout
const { Title } = Typography

function App() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true)
    setError(null)

    const loginRequest: HubLoginRequest = {
      email_address: values.email,
      password: values.password,
    }

    // Validate using shared validation logic
    const validationErrors = validateHubLoginRequest(loginRequest)
    if (validationErrors.length > 0) {
      setError(validationErrors.map(e => `${e.field}: ${e.message}`).join(', '))
      setLoading(false)
      return
    }

    try {
      const apiBaseUrl = await getApiBaseUrl()
      const response = await fetch(`${apiBaseUrl}/hub/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginRequest),
      })

      if (response.status === 400) {
        // Handle validation errors from backend
        const errors = await response.json()
        if (Array.isArray(errors)) {
          setError(errors.map((e: { field: string; message: string }) => `${e.field}: ${e.message}`).join(', '))
        } else {
          setError('Invalid request')
        }
        return
      }

      if (response.status === 401) {
        setError('Invalid credentials')
        return
      }

      if (response.status === 422) {
        setError('Account is not in a valid state to login')
        return
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data: HubLoginResponse = await response.json()
      setToken(data.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#1890ff',
        },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Card style={{ width: 400 }}>
            <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
              Vetchium Hub
            </Title>

            {token ? (
              <Alert
                message="Login Successful"
                description={`Token: ${token.substring(0, 16)}...`}
                type="success"
                showIcon
              />
            ) : (
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
                    { required: true, message: 'Please enter your email' },
                    { type: 'email', message: 'Please enter a valid email' },
                    { min: EMAIL_MIN_LENGTH, message: `Email must be at least ${EMAIL_MIN_LENGTH} characters` },
                    { max: EMAIL_MAX_LENGTH, message: `Email must be at most ${EMAIL_MAX_LENGTH} characters` },
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
                    { required: true, message: 'Please enter your password' },
                    { min: PASSWORD_MIN_LENGTH, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` },
                    { max: PASSWORD_MAX_LENGTH, message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters` },
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
            )}
          </Card>
        </Content>
      </Layout>
    </ConfigProvider>
  )
}

export default App
