import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, Typography, Alert, Spin } from "antd";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";

const { Title, Text } = Typography;

export function VerifyEmailPage() {
	const [searchParams] = useSearchParams();
	const { logout } = useAuth();
	const token = searchParams.get("token");

	const [verifying, setVerifying] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	useEffect(() => {
		if (!token) {
			setError("Invalid or missing verification token.");
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
					setError(data.message || "Failed to verify email change.");
				}
			} catch (err) {
				setError("Failed to connect to the server. Please try again later.");
				console.error("Verify email error:", err);
			} finally {
				setVerifying(false);
			}
		};

		verifyToken();
	}, [token, logout]);

	if (verifying) {
		return (
			<Card style={{ width: 400, textAlign: "center" }}>
				<Spin size="large" />
				<div style={{ marginTop: 16 }}>Verifying email change...</div>
			</Card>
		);
	}

	if (success) {
		return (
			<Card style={{ width: 400, textAlign: "center" }}>
				<Title level={3} style={{ color: "#52c41a" }}>
					Success!
				</Title>
				<Text>
					Your email address has been updated successfully. Please login with
					your new email.
				</Text>
				<div style={{ marginTop: 24 }}>
					<Link to="/login">
						<Button type="primary">Go to Login</Button>
					</Link>
				</div>
			</Card>
		);
	}

	return (
		<Card style={{ width: 400 }}>
			<Alert
				title="Verification Failed"
				description={error}
				type="error"
				showIcon
			/>
			<div style={{ marginTop: 24, textAlign: "center" }}>
				<Link to="/">
					<Button type="default">Go Home</Button>
				</Link>
			</div>
		</Card>
	);
}
