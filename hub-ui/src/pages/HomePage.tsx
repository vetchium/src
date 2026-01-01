import { useEffect } from "react";
import { Layout, Card, Typography, Button, Alert } from "antd";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { AppHeader } from "../components/AppHeader";

const { Content } = Layout;
const { Title, Text } = Typography;

export function HomePage() {
	const navigate = useNavigate();
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
		<Layout style={{ minHeight: "100vh" }}>
			<AppHeader />
			<Content
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
				}}
			>
				<Card style={{ width: 500 }}>
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

					<Button type="primary" onClick={handleLogout} block size="large">
						Logout
					</Button>
				</Card>
			</Content>
		</Layout>
	);
}
