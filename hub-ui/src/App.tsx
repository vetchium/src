import { useState, useEffect } from 'react'
import {
  ConfigProvider,
  Layout,
  Card,
  Descriptions,
  Button,
  Typography,
  Spin,
  Alert,
  Tag,
  Space,
  theme,
} from 'antd'
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  GlobalOutlined,
} from '@ant-design/icons'

const { Header, Content } = Layout
const { Title } = Typography

interface HealthResponse {
  status: string
  region: string
  global_db: number
  regional_ind1: number
  regional_usa1: number
  regional_deu1: number
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchHealth = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      setHealth(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
  }, [])

  const renderDbStatus = (value: number) => (
    <Tag
      icon={value === 1 ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
      color={value === 1 ? 'success' : 'error'}
    >
      {value === 1 ? 'Connected' : 'Error'}
    </Tag>
  )

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
        <Header style={{ display: 'flex', alignItems: 'center' }}>
          <Title level={3} style={{ color: 'white', margin: 0 }}>
            Vetchium Hub
          </Title>
        </Header>
        <Content style={{ padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          <Card
            title={
              <Space>
                <DatabaseOutlined />
                System Health
              </Space>
            }
            extra={
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={fetchHealth}
                loading={loading}
              >
                Refresh
              </Button>
            }
            style={{ width: '100%', maxWidth: 600 }}
          >
            {loading && !health && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <Spin size="large" />
              </div>
            )}

            {error && (
              <Alert
                message="Connection Error"
                description={error}
                type="error"
                showIcon
                action={
                  <Button size="small" danger onClick={fetchHealth}>
                    Retry
                  </Button>
                }
                style={{ marginBottom: 16 }}
              />
            )}

            {health && (
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="Status">
                  <Tag
                    icon={health.status === 'ok' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    color={health.status === 'ok' ? 'success' : 'error'}
                  >
                    {health.status.toUpperCase()}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Region">
                  <Tag icon={<GlobalOutlined />} color="blue">
                    {health.region.toUpperCase()}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Global Database">
                  {renderDbStatus(health.global_db)}
                </Descriptions.Item>
                <Descriptions.Item label="Regional DB (IND1)">
                  {renderDbStatus(health.regional_ind1)}
                </Descriptions.Item>
                <Descriptions.Item label="Regional DB (USA1)">
                  {renderDbStatus(health.regional_usa1)}
                </Descriptions.Item>
                <Descriptions.Item label="Regional DB (DEU1)">
                  {renderDbStatus(health.regional_deu1)}
                </Descriptions.Item>
              </Descriptions>
            )}
          </Card>
        </Content>
      </Layout>
    </ConfigProvider>
  )
}

export default App
