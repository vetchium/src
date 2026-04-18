import { Card, Col, Row, Skeleton, Typography, Button } from "antd";
import {
	SafetyOutlined,
	LogoutOutlined,
	TagsOutlined,
	TeamOutlined,
	FileSearchOutlined,
	CrownOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { useMyInfo } from "../hooks/useMyInfo";
import { Link } from "react-router-dom";

const { Title, Text } = Typography;

export function DashboardPage() {
	const { t } = useTranslation();
	const { logout, loading, sessionToken } = useAuth();
	const { data: myInfo, loading: myInfoLoading } = useMyInfo(sessionToken);

	const canViewDomains =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:view_domains") ||
		myInfo?.roles.includes("admin:manage_domains") ||
		false;

	const canViewUsers =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:view_users") ||
		myInfo?.roles.includes("admin:manage_users") ||
		false;

	const canManageTags =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:manage_tags") ||
		false;

	const canViewAuditLogs =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:view_audit_logs") ||
		false;

	const canViewOrgSubscriptions =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:view_org_subscriptions") ||
		myInfo?.roles.includes("admin:manage_org_subscriptions") ||
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
					{canViewDomains && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/approved-domains"
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
									<SafetyOutlined
										style={{ fontSize: 48, color: "#1890ff", marginBottom: 16 }}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("approvedDomains:dashboardTitle")}
									</Title>
									<Text type="secondary">
										{t("approvedDomains:dashboardDescription")}
									</Text>
								</Card>
							</Link>
						</Col>
					)}

					{canViewUsers && (
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
										style={{ fontSize: 48, color: "#722ed1", marginBottom: 16 }}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("userManagement:pageTitle")}
									</Title>
									<Text type="secondary">
										{t("userManagement:dashboardDescription")}
									</Text>
								</Card>
							</Link>
						</Col>
					)}

					{canManageTags && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/manage-tags"
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
									<TagsOutlined
										style={{ fontSize: 48, color: "#fa8c16", marginBottom: 16 }}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("tags:dashboardTitle")}
									</Title>
									<Text type="secondary">{t("tags:dashboardDescription")}</Text>
								</Card>
							</Link>
						</Col>
					)}

					{canViewAuditLogs && (
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
										style={{ fontSize: 48, color: "#13c2c2", marginBottom: 16 }}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("dashboard.auditLogs.title")}
									</Title>
									<Text type="secondary">
										{t("dashboard.auditLogs.description")}
									</Text>
								</Card>
							</Link>
						</Col>
					)}

					{canViewOrgSubscriptions && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/org-subscriptions"
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
										style={{ fontSize: 48, color: "#eb2f96", marginBottom: 16 }}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("orgSubscriptions:dashboardTitle")}
									</Title>
									<Text type="secondary">
										{t("orgSubscriptions:dashboardDescription")}
									</Text>
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
