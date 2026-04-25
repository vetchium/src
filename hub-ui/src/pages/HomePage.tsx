import { useEffect } from "react";
import { Card, Col, Row, Typography, Button } from "antd";
import {
	FileSearchOutlined,
	LockOutlined,
	MailOutlined,
	LogoutOutlined,
} from "@ant-design/icons";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";

const { Title, Text } = Typography;

export function HomePage() {
	const navigate = useNavigate();
	const { t } = useTranslation();
	const { logout, isAuthenticated } = useAuth();

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
				width: "100%",
				maxWidth: 1200,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<Title level={2} style={{ marginBottom: 24 }}>
				{t("dashboard.title")}
			</Title>

			<Row gutter={[24, 24]}>
				<Col xs={24} sm={12} lg={8}>
					<Link
						to="/my-activity"
						style={{ textDecoration: "none", display: "block", height: "100%" }}
					>
						<Card
							hoverable
							style={{ height: "100%", cursor: "pointer", textAlign: "center" }}
						>
							<FileSearchOutlined
								style={{ fontSize: 48, color: "#52c41a", marginBottom: 16 }}
							/>
							<Title level={4} style={{ marginBottom: 8 }}>
								{t("dashboard.myActivity.title")}
							</Title>
							<Text type="secondary">
								{t("dashboard.myActivity.description")}
							</Text>
						</Card>
					</Link>
				</Col>

				<Col xs={24} sm={12} lg={8}>
					<Link
						to="/change-password"
						style={{ textDecoration: "none", display: "block", height: "100%" }}
					>
						<Card
							hoverable
							style={{ height: "100%", cursor: "pointer", textAlign: "center" }}
						>
							<LockOutlined
								style={{ fontSize: 48, color: "#1677ff", marginBottom: 16 }}
							/>
							<Title level={4} style={{ marginBottom: 8 }}>
								{t("dashboard.changePassword")}
							</Title>
						</Card>
					</Link>
				</Col>

				<Col xs={24} sm={12} lg={8}>
					<Link
						to="/change-email"
						style={{ textDecoration: "none", display: "block", height: "100%" }}
					>
						<Card
							hoverable
							style={{ height: "100%", cursor: "pointer", textAlign: "center" }}
						>
							<MailOutlined
								style={{ fontSize: 48, color: "#fa8c16", marginBottom: 16 }}
							/>
							<Title level={4} style={{ marginBottom: 8 }}>
								{t("dashboard.changeEmail")}
							</Title>
						</Card>
					</Link>
				</Col>
			</Row>

			<div style={{ marginTop: 32, textAlign: "center" }}>
				<Button
					type="primary"
					danger
					onClick={handleLogout}
					size="large"
					icon={<LogoutOutlined />}
				>
					{t("logout.button")}
				</Button>
			</div>
		</div>
	);
}
