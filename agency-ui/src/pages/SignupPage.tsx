import { Card, Typography, Button } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { SignupForm } from "../forms/SignupForm";

const { Title, Text } = Typography;

export function SignupPage() {
	const { t } = useTranslation("auth");

	return (
		<Card style={{ width: 400, maxWidth: "90vw" }}>
			<Title level={2} style={{ textAlign: "center", marginBottom: 24 }}>
				{t("signup.title")}
			</Title>
			<SignupForm />
			<div style={{ textAlign: "center", marginTop: 16 }}>
				<Text>{t("signup.haveAccount")} </Text>
				<Link to="/login">
					<Button type="link" style={{ padding: 0 }}>
						{t("signup.loginLink")}
					</Button>
				</Link>
			</div>
		</Card>
	);
}
