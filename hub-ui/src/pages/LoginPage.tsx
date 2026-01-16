import { Card, Typography } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { LoginForm } from "../forms/LoginForm";

const { Title, Text } = Typography;

export function LoginPage() {
	const { t } = useTranslation(["common", "signup", "auth"]);
	const { authState } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		if (authState === "authenticated") {
			navigate("/");
		} else if (authState === "tfa") {
			navigate("/tfa");
		}
	}, [authState, navigate]);

	return (
		<Card style={{ width: 400 }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
				{t("auth:login.title")}
			</Title>

			<LoginForm />

			<div style={{ textAlign: "center", marginTop: 16 }}>
				<Text>
					<Link to="/signup">{t("signup:signupLink")}</Link>
				</Text>
			</div>
		</Card>
	);
}
