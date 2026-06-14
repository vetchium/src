import { Card, Col, Row, Skeleton, Typography, Button } from "antd";
import {
	LogoutOutlined,
	TeamOutlined,
	GlobalOutlined,
	BankOutlined,
	EnvironmentOutlined,
	ApartmentOutlined,
	CalendarOutlined,
	FileSearchOutlined,
	CrownOutlined,
	ShopOutlined,
	UnorderedListOutlined,
	StarOutlined,
	UsergroupAddOutlined,
	SolutionOutlined,
	ContactsOutlined,
	ShareAltOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	ListMyListingsRequest,
	ListMyListingsResponse,
} from "vetchium-specs/org/marketplace";
import { useAuth } from "../hooks/useAuth";
import { useMyInfo } from "../hooks/useMyInfo";
import { getApiBaseUrl } from "../config";

const { Title } = Typography;

// capability_id of the staffing capability (a data value, not a TypeSpec enum)
const STAFFING_CAPABILITY_ID = "staffing";

export function DashboardPage() {
	const { t } = useTranslation();
	const { logout, loading, sessionToken } = useAuth();
	const { data: myInfo, loading: myInfoLoading } = useMyInfo(sessionToken);

	const hasUsersAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_users") ||
		myInfo?.roles.includes("org:manage_users") ||
		false;

	const hasDomainsAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_domains") ||
		myInfo?.roles.includes("org:manage_domains") ||
		false;

	const hasCostCentersAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_costcenters") ||
		myInfo?.roles.includes("org:manage_costcenters") ||
		false;

	const hasAddressesAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_addresses") ||
		myInfo?.roles.includes("org:manage_addresses") ||
		false;

	const hasSubOrgsAccess = !!myInfo;

	const hasAuditLogsAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_audit_logs") ||
		false;

	const hasPlanAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_plan") ||
		myInfo?.roles.includes("org:manage_plan") ||
		false;

	// Marketplace: discover = all authenticated users; listings/subscriptions/clients by role
	const hasMarketplaceAccess = !!myInfo;

	const hasListingsAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_listings") ||
		myInfo?.roles.includes("org:manage_listings") ||
		false;

	const hasSubscriptionsAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_subscriptions") ||
		myInfo?.roles.includes("org:manage_subscriptions") ||
		false;

	const hasClientsAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_listings") ||
		myInfo?.roles.includes("org:manage_listings") ||
		false;

	const hasOpeningsAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_openings") ||
		myInfo?.roles.includes("org:manage_openings") ||
		false;

	// Candidacies/applications have dedicated roles; mirror the backend gate on
	// /org/list-candidacies (view_applications OR view/manage_candidacies).
	const hasCandidaciesAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_applications") ||
		myInfo?.roles.includes("org:view_candidacies") ||
		myInfo?.roles.includes("org:manage_candidacies") ||
		false;

	// My Interviews is available to any authenticated org user — being placed
	// on an interview panel, not a role, is what surfaces interviews here.
	const hasMyInterviewsAccess = !!myInfo;

	// Agency referrals (agency side): gated on BOTH the agency-side role AND the
	// org actually being a registered staffing provider — i.e. it has an active
	// marketplace listing carrying the staffing capability. Without an active
	// staffing listing no consumer can subscribe/assign it, so there is nothing
	// to refer into and the tile stays hidden.
	const hasAgencyReferralRole =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:view_agency_referrals") ||
		myInfo?.roles.includes("org:refer_candidates") ||
		false;

	const [isStaffingProvider, setIsStaffingProvider] = useState(false);

	useEffect(() => {
		if (!sessionToken || !hasAgencyReferralRole) return;
		let cancelled = false;
		(async () => {
			try {
				const baseUrl = await getApiBaseUrl();
				// Ask the server for a single active listing carrying the staffing
				// capability. limit:1 + the capability filter make this a definitive,
				// pagination-proof answer regardless of how many listings the org has.
				const req: ListMyListingsRequest = {
					filter_status: "active",
					filter_capability_id: STAFFING_CAPABILITY_ID,
					limit: 1,
				};
				const res = await fetch(`${baseUrl}/org/marketplace/list-listings`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data: ListMyListingsResponse = await res.json();
					if (!cancelled)
						setIsStaffingProvider((data.listings ?? []).length > 0);
				}
			} catch {
				// network error — leave the tile hidden rather than risk a dead link
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [sessionToken, hasAgencyReferralRole]);

	const hasAgencyReferralsAccess = hasAgencyReferralRole && isStaffingProvider;

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
					{hasUsersAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/users"
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
										{t("users.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("users.description")}
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

					{hasDomainsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/domains"
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
										{t("domains.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("domains.description")}
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

					{hasOpeningsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/openings"
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
									<SolutionOutlined
										style={{
											fontSize: 48,
											color: "#2f54eb",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("openings.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("openings.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasCandidaciesAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/candidacies"
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
									<ContactsOutlined
										style={{
											fontSize: 48,
											color: "#1d39c4",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("candidacies.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("candidacies.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasMyInterviewsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/my-interviews"
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
									<CalendarOutlined
										style={{
											fontSize: 48,
											color: "#9254de",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("myInterviews.title")}
									</Title>
									<Typography.Text type="secondary">
										{t("myInterviews.description")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasAddressesAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/settings/addresses"
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
									<EnvironmentOutlined
										style={{
											fontSize: 48,
											color: "#ff4d4f",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("addresses:title")}
									</Title>
									<Typography.Text type="secondary">
										{t(
											"addresses:description",
											"Manage company physical addresses"
										)}
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

					{hasPlanAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/settings/plan"
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

					{hasMarketplaceAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/marketplace"
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
									<ShopOutlined
										style={{
											fontSize: 48,
											color: "#096dd9",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("marketplace:dashboard.discoverTitle")}
									</Title>
									<Typography.Text type="secondary">
										{t("marketplace:dashboard.discoverDescription")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasListingsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/marketplace/listings"
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
									<UnorderedListOutlined
										style={{
											fontSize: 48,
											color: "#08979c",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("marketplace:dashboard.listingsTitle")}
									</Title>
									<Typography.Text type="secondary">
										{t("marketplace:dashboard.listingsDescription")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasSubscriptionsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/marketplace/subscriptions"
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
									<StarOutlined
										style={{
											fontSize: 48,
											color: "#d48806",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("marketplace:dashboard.subscriptionsTitle")}
									</Title>
									<Typography.Text type="secondary">
										{t("marketplace:dashboard.subscriptionsDescription")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasClientsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/marketplace/clients"
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
									<UsergroupAddOutlined
										style={{
											fontSize: 48,
											color: "#389e0d",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("marketplace:dashboard.clientsTitle")}
									</Title>
									<Typography.Text type="secondary">
										{t("marketplace:dashboard.clientsDescription")}
									</Typography.Text>
								</Card>
							</Link>
						</Col>
					)}

					{hasAgencyReferralsAccess && (
						<Col xs={24} sm={12} lg={8}>
							<Link
								to="/referrals"
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
									<ShareAltOutlined
										style={{
											fontSize: 48,
											color: "#722ed1",
											marginBottom: 16,
										}}
									/>
									<Title level={4} style={{ marginBottom: 8 }}>
										{t("agencyReferrals:dashboardTitle")}
									</Title>
									<Typography.Text type="secondary">
										{t("agencyReferrals:dashboardDescription")}
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
