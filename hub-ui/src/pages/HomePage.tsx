import { useEffect } from "react";
import { Avatar, Card, Col, Row, Typography, theme } from "antd";
import {
	FileSearchOutlined,
	TeamOutlined,
	UserOutlined,
} from "@ant-design/icons";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { useMyInfo } from "../hooks/useMyInfo";

const { Title, Text } = Typography;

export function HomePage() {
	const navigate = useNavigate();
	const { t } = useTranslation();
	const { isAuthenticated, sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { token } = theme.useToken();

	useEffect(() => {
		if (!isAuthenticated) {
			navigate("/login");
		}
	}, [isAuthenticated, navigate]);

	if (!isAuthenticated) {
		return null;
	}

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 900,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			{/* Welcome banner */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 16,
					marginBottom: 32,
					padding: "20px 24px",
					background: "var(--ant-color-bg-container)",
					border: "1px solid var(--ant-color-border)",
					borderRadius: 8,
				}}
			>
				<Avatar size={56} icon={<UserOutlined />} />
				<div>
					<Title level={3} style={{ margin: 0 }}>
						{t("dashboard.greeting", {
							handle: myInfo?.handle ?? "…",
						})}
					</Title>
					{myInfo?.handle && (
						<Text type="secondary" style={{ fontFamily: "monospace" }}>
							@{myInfo.handle}
						</Text>
					)}
				</div>
			</div>

			{/* Navigation tiles */}
			<Row gutter={[20, 20]}>
				<Col xs={24} sm={12} lg={8}>
					<Link
						to="/settings/profile"
						style={{ textDecoration: "none", display: "block", height: "100%" }}
					>
						<Card hoverable style={{ height: "100%", cursor: "pointer" }}>
							<div
								style={{ display: "flex", alignItems: "flex-start", gap: 16 }}
							>
								<UserOutlined
									style={{ fontSize: 28, color: token.colorPrimary, marginTop: 2 }}
								/>
								<div>
									<Title level={5} style={{ marginBottom: 4 }}>
										{t("dashboard.myProfile.title")}
									</Title>
									<Text type="secondary" style={{ fontSize: 13 }}>
										{t("dashboard.myProfile.description")}
									</Text>
								</div>
							</div>
						</Card>
					</Link>
				</Col>

				<Col xs={24} sm={12} lg={8}>
					<Link
						to="/connections"
						style={{ textDecoration: "none", display: "block", height: "100%" }}
					>
						<Card hoverable style={{ height: "100%", cursor: "pointer" }}>
							<div
								style={{ display: "flex", alignItems: "flex-start", gap: 16 }}
							>
								<TeamOutlined
									style={{ fontSize: 28, color: token.colorPrimary, marginTop: 2 }}
								/>
								<div>
									<Title level={5} style={{ marginBottom: 4 }}>
										{t("dashboard.connections.title")}
									</Title>
									<Text type="secondary" style={{ fontSize: 13 }}>
										{t("dashboard.connections.description")}
									</Text>
								</div>
							</div>
						</Card>
					</Link>
				</Col>

				<Col xs={24} sm={12} lg={8}>
					<Link
						to="/my-activity"
						style={{ textDecoration: "none", display: "block", height: "100%" }}
					>
						<Card hoverable style={{ height: "100%", cursor: "pointer" }}>
							<div
								style={{ display: "flex", alignItems: "flex-start", gap: 16 }}
							>
								<FileSearchOutlined
									style={{ fontSize: 28, color: token.colorPrimary, marginTop: 2 }}
								/>
								<div>
									<Title level={5} style={{ marginBottom: 4 }}>
										{t("dashboard.myActivity.title")}
									</Title>
									<Text type="secondary" style={{ fontSize: 13 }}>
										{t("dashboard.myActivity.description")}
									</Text>
								</div>
							</div>
						</Card>
					</Link>
				</Col>
			</Row>
		</div>
	);
}
