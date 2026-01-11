import { Card, Typography, Button } from "antd";
import { LogoutOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { DomainVerificationSection } from "../components/DomainVerificationSection";

const { Title } = Typography;

export function DashboardPage() {
	const { t } = useTranslation();
	const { logout, loading } = useAuth();

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 24,
				maxWidth: 600,
				width: "100%",
				padding: "0 16px",
			}}
		>
			<Card style={{ width: "100%", textAlign: "center" }}>
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

			<div style={{ width: "100%" }}>
				<DomainVerificationSection />
			</div>
		</div>
	);
}
