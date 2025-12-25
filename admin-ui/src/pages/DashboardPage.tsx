import { Card, Typography, Button } from "antd";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";

const { Title, Text } = Typography;

export function DashboardPage() {
	const { t } = useTranslation("auth");
	const { logout, loading } = useAuth();

	return (
		<Card style={{ width: 600 }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
				{t("dashboard.title")}
			</Title>

			<Text
				type="secondary"
				style={{ display: "block", textAlign: "center", marginBottom: 24 }}
			>
				{t("dashboard.subtitle")}
			</Text>

			<Button
				type="primary"
				danger
				onClick={logout}
				loading={loading}
				block
				size="large"
			>
				{t("logout.button")}
			</Button>
		</Card>
	);
}
