import { Card, Skeleton, Typography, Button } from "antd";
import {
	LogoutOutlined,
	TeamOutlined,
	GlobalOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useMyInfo } from "../hooks/useMyInfo";

const { Title } = Typography;

export function DashboardPage() {
	const { t } = useTranslation();
	const { logout, loading, sessionToken } = useAuth();
	const { data: myInfo, loading: myInfoLoading } = useMyInfo(sessionToken);

	const hasUserManagementAccess =
		myInfo?.roles.includes("employer:superadmin") ||
		myInfo?.roles.includes("employer:invite_users") ||
		myInfo?.roles.includes("employer:manage_users") ||
		false;

	const hasDomainManagementAccess =
		myInfo?.roles.includes("employer:superadmin") ||
		myInfo?.roles.includes("employer:read_domains") ||
		false;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 24,
				maxWidth: 600,
				width: "100%",
				padding: "0 16px",
			}}
		>
			{myInfoLoading ? (
				<>
					<Card style={{ width: "100%" }}>
						<Skeleton active />
					</Card>
					<Card style={{ width: "100%" }}>
						<Skeleton active />
					</Card>
				</>
			) : (
				<>
					{hasUserManagementAccess && (
						<Link
							to="/user-management"
							style={{ textDecoration: "none", width: "100%" }}
						>
							<Card
								hoverable
								style={{
									width: "100%",
									cursor: "pointer",
									textAlign: "center",
								}}
							>
								<TeamOutlined
									style={{ fontSize: 48, color: "#722ed1", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("userManagement.title")}
								</Title>
								<Typography.Text type="secondary">
									{t("userManagement.description")}
								</Typography.Text>
							</Card>
						</Link>
					)}
					{hasDomainManagementAccess && (
						<Link
							to="/domain-management"
							style={{ textDecoration: "none", width: "100%" }}
						>
							<Card
								hoverable
								style={{
									width: "100%",
									cursor: "pointer",
									textAlign: "center",
								}}
							>
								<GlobalOutlined
									style={{ fontSize: 48, color: "#1890ff", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("domainManagement.title")}
								</Title>
								<Typography.Text type="secondary">
									{t("domainManagement.description")}
								</Typography.Text>
							</Card>
						</Link>
					)}
				</>
			)}

			<Card style={{ width: "100%", textAlign: "center" }}>
				<Title level={3} style={{ marginBottom: 24 }}>
					{t("dashboard.title")}
				</Title>

				<Button
					type="primary"
					danger
					onClick={logout}
					loading={loading}
					block
					size="large"
					icon={<LogoutOutlined />}
				>
					{t("logout.button")}
				</Button>
			</Card>
		</div>
	);
}
