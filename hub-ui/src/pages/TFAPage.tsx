import { useEffect } from "react";
import { Layout, Card, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TFAForm } from "../forms/TFAForm";
import { useAuth } from "../contexts/AuthContext";

const { Content } = Layout;
const { Title, Text } = Typography;

export function TFAPage() {
	const { t } = useTranslation("auth");
	const navigate = useNavigate();
	const { authState } = useAuth();

	useEffect(() => {
		if (authState === "authenticated") {
			navigate("/");
		} else if (authState === "login") {
			navigate("/login");
		}
	}, [authState, navigate]);

	return (
		<Layout style={{ minHeight: "100vh" }}>
			<Content
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
				}}
			>
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
			</Content>
		</Layout>
	);
}
