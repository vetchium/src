import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, Typography, Alert, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";

const { Title, Text } = Typography;

export function VerifyEmailPage() {
	const [searchParams] = useSearchParams();
	const { logout } = useAuth();
	const { t } = useTranslation("auth");
	const token = searchParams.get("token");

	const [verifying, setVerifying] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	useEffect(() => {
		if (!token) {
			setError(t("verifyEmail.invalidToken"));
			setVerifying(false);
			return;
		}

		const verifyToken = async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(
					`${apiBaseUrl}/hub/complete-email-change`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ verification_token: token }),
					}
				);

				if (response.ok) {
					setSuccess(true);
					// Invalidate session locally as well, since server invalidated all sessions
					logout();
				} else {
					const data = await response.json();
					setError(data.message || t("verifyEmail.failed"));
				}
			} catch (err) {
				setError(t("verifyEmail.failed"));
				console.error("Verify email error:", err);
			} finally {
				setVerifying(false);
			}
		};

		verifyToken();
	}, [token, logout, t]);

	if (verifying) {
		return (
			<Card style={{ width: 400, textAlign: "center" }}>
				<Spin size="large" />
				<div style={{ marginTop: 16 }}>{t("verifyEmail.verifying")}</div>
			</Card>
		);
	}

	if (success) {
		return (
			<Card style={{ width: 400, textAlign: "center" }}>
				<Title level={3} style={{ color: "#52c41a" }}>
					{t("verifyEmail.successTitle")}
				</Title>
				<Text>{t("verifyEmail.successMessage")}</Text>
				<div style={{ marginTop: 24 }}>
					<Link to="/login">
						<Button type="primary">{t("verifyEmail.goToLogin")}</Button>
					</Link>
				</div>
			</Card>
		);
	}

	return (
		<Card style={{ width: 400 }}>
			<Alert
				title={t("verifyEmail.failedTitle")}
				description={error ?? undefined}
				type="error"
				showIcon
			/>
			<div style={{ marginTop: 24, textAlign: "center" }}>
				<Link to="/">
					<Button type="default">{t("verifyEmail.goHome")}</Button>
				</Link>
			</div>
		</Card>
	);
}
