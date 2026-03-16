import { useEffect } from "react";
import { Card, Typography, Button, Alert } from "antd";
import { FileSearchOutlined } from "@ant-design/icons";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";

const { Title, Text } = Typography;

export function HomePage() {
	const navigate = useNavigate();
	const { t } = useTranslation();
	const { sessionToken, handle, logout, isAuthenticated } = useAuth();

	useEffect(() => {
		if (!isAuthenticated) {
			navigate("/login");
		}
	}, [isAuthenticated, navigate]);

	const handleLogout = async () => {
		await logout();
		navigate("/login");
	};

	if (!isAuthenticated) {
		return null;
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 24,
				width: 500,
			}}
		>
			<Link to="/my-activity" style={{ textDecoration: "none", width: "100%" }}>
				<Card
					hoverable
					style={{ width: "100%", cursor: "pointer", textAlign: "center" }}
				>
					<FileSearchOutlined
						style={{ fontSize: 48, color: "#52c41a", marginBottom: 16 }}
					/>
					<Title level={4} style={{ marginBottom: 8 }}>
						{t("dashboard.myActivity.title")}
					</Title>
					<Text type="secondary">{t("dashboard.myActivity.description")}</Text>
				</Card>
			</Link>

			<Card style={{ width: "100%" }}>
				<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
					Welcome to Vetchium Hub
				</Title>

				<Alert
					description={
						<div>
							<Text strong>Login Successful</Text>
							<br />
							{handle && (
								<Text>
									Handle: <strong>{handle}</strong>
									<br />
								</Text>
							)}
							<Text>Session Token: {sessionToken?.substring(0, 16)}...</Text>
						</div>
					}
					type="success"
					showIcon
					style={{ marginBottom: 16 }}
				/>

				<div style={{ marginTop: 24, marginBottom: 16 }}>
					<Button
						type="default"
						block
						style={{ marginBottom: 12 }}
						onClick={() => navigate("/change-password")}
					>
						Change Password
					</Button>
					<Button
						type="default"
						block
						style={{ marginBottom: 12 }}
						onClick={() => navigate("/change-email")}
					>
						Change Email
					</Button>
				</div>

				<Button type="primary" onClick={handleLogout} block size="large">
					Logout
				</Button>
			</Card>
		</div>
	);
}
