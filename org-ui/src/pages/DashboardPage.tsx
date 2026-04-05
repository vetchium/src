import { Card, Skeleton, Typography, Button } from "antd";
import {
	LogoutOutlined,
	TeamOutlined,
	GlobalOutlined,
	BankOutlined,
	ApartmentOutlined,
	FileSearchOutlined,
	ShopOutlined,
	RocketOutlined,
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
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_users") ||
		myInfo?.roles.includes("org:manage_users") ||
		false;

	const hasDomainManagementAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_domains") ||
		myInfo?.roles.includes("org:manage_domains") ||
		false;

	const hasCostCentersAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_costcenters") ||
		myInfo?.roles.includes("org:manage_costcenters") ||
		false;

	// Any authenticated user can see SubOrgs (list is unrestricted)
	const hasSubOrgsAccess = !!myInfo;

	// Provider Hub: only superadmin or manage_marketplace role
	const hasProviderHubAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

	// Browse: any authenticated user
	const hasBrowseAccess = !!myInfo;

	const hasAuditLogsAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_audit_logs") ||
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

					{hasSubOrgsAccess && (
						<Link
							to="/suborgs"
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
								<ApartmentOutlined
									style={{ fontSize: 48, color: "#fa8c16", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("subOrgs.title")}
								</Title>
								<Typography.Text type="secondary">
									{t("subOrgs.description")}
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
					{hasCostCentersAccess && (
						<Link
							to="/cost-centers"
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
								<BankOutlined
									style={{ fontSize: 48, color: "#52c41a", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("costCenters.title")}
								</Title>
								<Typography.Text type="secondary">
									{t("costCenters.description")}
								</Typography.Text>
							</Card>
						</Link>
					)}
					{hasAuditLogsAccess && (
						<Link
							to="/audit-logs"
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
								<FileSearchOutlined
									style={{ fontSize: 48, color: "#13c2c2", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("dashboard.auditLogs.title")}
								</Title>
								<Typography.Text type="secondary">
									{t("dashboard.auditLogs.description")}
								</Typography.Text>
							</Card>
						</Link>
					)}
					{hasProviderHubAccess && (
						<Link
							to="/marketplace/provide"
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
								<RocketOutlined
									style={{ fontSize: 48, color: "#fa541c", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("providerHub.title")}
								</Title>
								<Typography.Text type="secondary">
									{t("providerHub.description")}
								</Typography.Text>
							</Card>
						</Link>
					)}
					{hasBrowseAccess && (
						<Link
							to="/marketplace"
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
								<ShopOutlined
									style={{ fontSize: 48, color: "#1890ff", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("browseMarketplace.title")}
								</Title>
								<Typography.Text type="secondary">
									{t("browseMarketplace.description")}
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
