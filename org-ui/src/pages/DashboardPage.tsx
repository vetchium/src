import { Card, Col, Row, Skeleton, Typography, Button } from "antd";
import {
	LogoutOutlined,
	TeamOutlined,
	GlobalOutlined,
	BankOutlined,
	ApartmentOutlined,
	FileSearchOutlined,
	CrownOutlined,
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

	const hasSubOrgsAccess = !!myInfo;

	const hasAuditLogsAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_audit_logs") ||
		false;

	const hasSubscriptionAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_subscription") ||
		myInfo?.roles.includes("org:manage_subscription") ||
		false;

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

			{myInfoLoading ? (
				<Row gutter={[24, 24]}>
					{[1, 2, 3].map((i) => (
						<Col key={i} xs={24} sm={12} lg={8}>
							<Card>
								<Skeleton active />
							</Card>
						</Col>
					))}
				</Row>
			) : (
				<Row gutter={[24, 24]}>
					{hasUserManagementAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/user-management"
								style={{
									textDecoration: "none",
									display: "block",
									height: "100%",
								}}
							>
								<Card
									hoverable
									style={{
										height: "100%",
										cursor: "pointer",
										textAlign: "center",
									}}
								>
									<TeamOutlined
										style={{
											fontSize: 48,
											color: "#722ed1",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("userManagement.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("userManagement.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasSubOrgsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/suborgs"
								style={{
									textDecoration: "none",
									display: "block",
									height: "100%",
								}}
							>
								<Card
									hoverable
									style={{
										height: "100%",
										cursor: "pointer",
										textAlign: "center",
									}}
								>
									<ApartmentOutlined
										style={{
											fontSize: 48,
											color: "#fa8c16",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("subOrgs.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("subOrgs.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasDomainManagementAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/domain-management"
								style={{
									textDecoration: "none",
									display: "block",
									height: "100%",
								}}
							>
								<Card
									hoverable
									style={{
										height: "100%",
										cursor: "pointer",
										textAlign: "center",
									}}
								>
									<GlobalOutlined
										style={{
											fontSize: 48,
											color: "#1890ff",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("domainManagement.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("domainManagement.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasCostCentersAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/cost-centers"
								style={{
									textDecoration: "none",
									display: "block",
									height: "100%",
								}}
							>
								<Card
									hoverable
									style={{
										height: "100%",
										cursor: "pointer",
										textAlign: "center",
									}}
								>
									<BankOutlined
										style={{
											fontSize: 48,
											color: "#52c41a",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("costCenters.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("costCenters.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasAuditLogsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/audit-logs"
								style={{
									textDecoration: "none",
									display: "block",
									height: "100%",
								}}
							>
								<Card
									hoverable
									style={{
										height: "100%",
										cursor: "pointer",
										textAlign: "center",
									}}
								>
									<FileSearchOutlined
										style={{
											fontSize: 48,
											color: "#13c2c2",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("dashboard.auditLogs.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("dashboard.auditLogs.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasSubscriptionAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/settings/subscription"
								style={{
									textDecoration: "none",
									display: "block",
									height: "100%",
								}}
							>
								<Card
									hoverable
									style={{
										height: "100%",
										cursor: "pointer",
										textAlign: "center",
									}}
								>
									<CrownOutlined
										style={{
											fontSize: 48,
											color: "#eb2f96",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("subscription.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("subscription.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

				</Row>
			)}

			<div style={{ marginTop: 32, textAlign: "center" }}>
				<Button
					type="primary"
					danger
					onClick={logout}
					loading={loading}
					size="large"
					icon={<LogoutOutlined />}
				>
					{t("logout.button")}
				</Button>
			</div>
		</div>
	);
}
