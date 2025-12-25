import { Card, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { TFAForm } from "../forms/TFAForm";

const { Title, Text } = Typography;

export function TFAPage() {
	const { t } = useTranslation("auth");

	return (
		<Card style={{ width: 400 }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 8 }}>
				{t("tfa.title")}
			</Title>
			<Text
				type="secondary"
				style={{ display: "block", textAlign: "center", marginBottom: 24 }}
			>
				{t("tfa.subtitle")}
			</Text>
			<TFAForm />
		</Card>
	);
}
