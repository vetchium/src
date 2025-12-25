import { Card, Typography, Button } from "antd";
import { SafetyOutlined, LogoutOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";

const { Title, Text } = Typography;

interface DashboardPageProps {
	onNavigate: (page: "dashboard" | "approved-domains") => void;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
	const { t } = useTranslation();
	const { logout, loading } = useAuth();

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 24,
				maxWidth: 800,
				width: "100%",
			}}
		>
			<Card
				hoverable
				onClick={() => onNavigate("approved-domains")}
				style={{ width: 400, cursor: "pointer", textAlign: "center" }}
			>
				<SafetyOutlined
					style={{ fontSize: 48, color: "#1890ff", marginBottom: 16 }}
				/>
				<Title level={4} style={{ marginBottom: 8 }}>
					{t("approvedDomains.dashboardTitle")}
				</Title>
				<Text type="secondary">
					{t("approvedDomains.dashboardDescription")}
				</Text>
			</Card>

			<Card style={{ width: 400, textAlign: "center" }}>
				<Title level={3} style={{ marginBottom: 24 }}>
					{t("dashboard.title")}
				</Title>

				<Button
					type="primary"
					danger
					onClick={logout}
					loading={loading}
					block
					size="large"
					icon={<LogoutOutlined />}
				>
					{t("logout.button")}
				</Button>
			</Card>
		</div>
	);
}
