import { Card, Typography, Button } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LoginForm } from "../forms/LoginForm";

const { Title, Text } = Typography;

export function LoginPage() {
	const { t } = useTranslation("auth");

	return (
		<Card style={{ width: 400, maxWidth: "90vw" }}>
			<Title level={2} style={{ textAlign: "center", marginBottom: 24 }}>
				{t("login.title")}
			</Title>
			<LoginForm />
			<div style={{ textAlign: "center", marginTop: 16 }}>
				<Text>{t("login.noAccount")} </Text>
				<Link to="/signup">
					<Button type="link" style={{ padding: 0 }}>
						{t("login.signupLink")}
					</Button>
				</Link>
			</div>
		</Card>
	);
}
