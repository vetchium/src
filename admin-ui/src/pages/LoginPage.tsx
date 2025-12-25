import { Card, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { LoginForm } from "../forms/LoginForm";

const { Title } = Typography;

export function LoginPage() {
	const { t } = useTranslation("auth");

	return (
		<Card style={{ width: 400 }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
				{t("login.title")}
			</Title>
			<LoginForm />
		</Card>
	);
}
