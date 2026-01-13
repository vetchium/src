import { Card, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { SignupCompleteForm } from "../forms/SignupCompleteForm";

const { Title, Text } = Typography;

export function SignupCompletePage() {
	const { t } = useTranslation("auth");

	return (
		<Card style={{ width: 400, maxWidth: "90vw" }}>
			<Title level={2} style={{ textAlign: "center", marginBottom: 8 }}>
				{t("signupComplete.title")}
			</Title>
			<Text
				type="secondary"
				style={{ display: "block", textAlign: "center", marginBottom: 24 }}
			>
				{t("signupComplete.subtitle")}
			</Text>
			<SignupCompleteForm />
		</Card>
	);
}
