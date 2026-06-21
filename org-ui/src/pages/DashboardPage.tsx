import {
	Alert,
	Card,
	Col,
	Divider,
	Row,
	Skeleton,
	Tooltip,
	Typography,
	Button,
} from "antd";
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
	PushpinOutlined,
	PushpinFilled,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	ListMyListingsRequest,
	ListMyListingsResponse,
} from "vetchium-specs/org/marketplace";
import type { AgencyReferralSummaryResponse } from "vetchium-specs/org/agency-referrals";
import { useAuth } from "../hooks/useAuth";
import { useMyInfo } from "../hooks/useMyInfo";
import { getApiBaseUrl } from "../config";

const { Title } = Typography;

// capability_id of the staffing capability (a data value, not a TypeSpec enum)
const STAFFING_CAPABILITY_ID = "staffing";

// localStorage key holding the user's pinned tile keys (client-side only, per
// the product requirement that pinning is a local preference).
const PINNED_STORAGE_KEY = "org_dashboard_pinned";

// Section identifiers used to group the dashboard tiles. "pinned" is a virtual
// section assembled at render time from the user's localStorage preference.
type SectionId = "hiring" | "marketplace" | "organization" | "administration";

const SECTION_ORDER: SectionId[] = [
	"hiring",
	"marketplace",
	"organization",
	"administration",
];

interface TileDef {
	key: string;
	to: string;
	icon: ReactNode;
	color: string;
	title: string;
	description: string;
	section: SectionId;
	show: boolean;
}

function loadPinned(): string[] {
	try {
		const raw = localStorage.getItem(PINNED_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((k) => typeof k === "string")
			: [];
	} catch {
		return [];
	}
}

export function DashboardPage() {
	const { t } = useTranslation();
	const { logout, loading, sessionToken } = useAuth();
	const { data: myInfo, loading: myInfoLoading } = useMyInfo(sessionToken);

	const [pinned, setPinned] = useState<string[]>(loadPinned);

	const togglePin = useCallback((key: string) => {
		setPinned((prev) => {
			const next = prev.includes(key)
				? prev.filter((k) => k !== key)
				: [...prev, key];
			try {
				localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
			} catch {
				// storage unavailable (private mode) — pinning stays in-memory only
			}
			return next;
		});
	}, []);

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

	// Coverage warning: how many of the agency's openings have no active assignee.
	const [needsReassignment, setNeedsReassignment] = useState(0);
	useEffect(() => {
		if (!sessionToken || !hasAgencyReferralsAccess) return;
		let cancelled = false;
		(async () => {
			try {
				const baseUrl = await getApiBaseUrl();
				const res = await fetch(`${baseUrl}/org/get-agency-referral-summary`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({}),
				});
				if (res.status === 200) {
					const data: AgencyReferralSummaryResponse = await res.json();
					if (!cancelled) setNeedsReassignment(data.needs_reassignment_count);
				}
			} catch {
				// non-fatal — just don't show the banner
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [sessionToken, hasAgencyReferralsAccess]);

	// Tile catalogue — single source of truth, grouped by section. Order within a
	// section is the array order. `show` gates a tile on the caller's roles.
	const tiles: TileDef[] = useMemo(
		() => [
			// Hiring
			{
				key: "openings",
				to: "/openings",
				icon: <SolutionOutlined />,
				color: "#2f54eb",
				title: t("openings.title"),
				description: t("openings.description"),
				section: "hiring",
				show: hasOpeningsAccess,
			},
			{
				key: "candidacies",
				to: "/candidacies",
				icon: <ContactsOutlined />,
				color: "#1d39c4",
				title: t("candidacies.title"),
				description: t("candidacies.description"),
				section: "hiring",
				show: hasCandidaciesAccess,
			},
			{
				key: "my-interviews",
				to: "/my-interviews",
				icon: <CalendarOutlined />,
				color: "#9254de",
				title: t("myInterviews.title"),
				description: t("myInterviews.description"),
				section: "hiring",
				show: hasMyInterviewsAccess,
			},
			{
				key: "agency-referrals",
				to: "/referrals",
				icon: <ShareAltOutlined />,
				color: "#722ed1",
				title: t("agencyReferrals:dashboardTitle"),
				description: t("agencyReferrals:dashboardDescription"),
				section: "hiring",
				show: hasAgencyReferralsAccess,
			},
			// Marketplace
			{
				key: "marketplace",
				to: "/marketplace",
				icon: <ShopOutlined />,
				color: "#096dd9",
				title: t("marketplace:dashboard.discoverTitle"),
				description: t("marketplace:dashboard.discoverDescription"),
				section: "marketplace",
				show: hasMarketplaceAccess,
			},
			{
				key: "listings",
				to: "/marketplace/listings",
				icon: <UnorderedListOutlined />,
				color: "#08979c",
				title: t("marketplace:dashboard.listingsTitle"),
				description: t("marketplace:dashboard.listingsDescription"),
				section: "marketplace",
				show: hasListingsAccess,
			},
			{
				key: "subscriptions",
				to: "/marketplace/subscriptions",
				icon: <StarOutlined />,
				color: "#d48806",
				title: t("marketplace:dashboard.subscriptionsTitle"),
				description: t("marketplace:dashboard.subscriptionsDescription"),
				section: "marketplace",
				show: hasSubscriptionsAccess,
			},
			{
				key: "clients",
				to: "/marketplace/clients",
				icon: <UsergroupAddOutlined />,
				color: "#389e0d",
				title: t("marketplace:dashboard.clientsTitle"),
				description: t("marketplace:dashboard.clientsDescription"),
				section: "marketplace",
				show: hasClientsAccess,
			},
			// Organization
			{
				key: "users",
				to: "/users",
				icon: <TeamOutlined />,
				color: "#722ed1",
				title: t("users.title"),
				description: t("users.description"),
				section: "organization",
				show: hasUsersAccess,
			},
			{
				key: "suborgs",
				to: "/suborgs",
				icon: <ApartmentOutlined />,
				color: "#fa8c16",
				title: t("subOrgs.title"),
				description: t("subOrgs.description"),
				section: "organization",
				show: hasSubOrgsAccess,
			},
			{
				key: "domains",
				to: "/domains",
				icon: <GlobalOutlined />,
				color: "#1890ff",
				title: t("domains.title"),
				description: t("domains.description"),
				section: "organization",
				show: hasDomainsAccess,
			},
			{
				key: "cost-centers",
				to: "/cost-centers",
				icon: <BankOutlined />,
				color: "#52c41a",
				title: t("costCenters.title"),
				description: t("costCenters.description"),
				section: "organization",
				show: hasCostCentersAccess,
			},
			{
				key: "addresses",
				to: "/settings/addresses",
				icon: <EnvironmentOutlined />,
				color: "#ff4d4f",
				title: t("addresses:title"),
				description: t(
					"addresses:description",
					"Manage company physical addresses"
				),
				section: "organization",
				show: hasAddressesAccess,
			},
			// Administration
			{
				key: "plan",
				to: "/settings/plan",
				icon: <CrownOutlined />,
				color: "#eb2f96",
				title: t("subscription.title"),
				description: t("subscription.description"),
				section: "administration",
				show: hasPlanAccess,
			},
			{
				key: "audit-logs",
				to: "/audit-logs",
				icon: <FileSearchOutlined />,
				color: "#13c2c2",
				title: t("dashboard.auditLogs.title"),
				description: t("dashboard.auditLogs.description"),
				section: "administration",
				show: hasAuditLogsAccess,
			},
		],
		[
			t,
			hasOpeningsAccess,
			hasCandidaciesAccess,
			hasMyInterviewsAccess,
			hasAgencyReferralsAccess,
			hasMarketplaceAccess,
			hasListingsAccess,
			hasSubscriptionsAccess,
			hasClientsAccess,
			hasUsersAccess,
			hasSubOrgsAccess,
			hasDomainsAccess,
			hasCostCentersAccess,
			hasAddressesAccess,
			hasPlanAccess,
			hasAuditLogsAccess,
		]
	);

	const visibleTiles = useMemo(
		() => tiles.filter((tile) => tile.show),
		[tiles]
	);

	// Only keep pins that still resolve to a visible tile (roles may have changed).
	const pinnedTiles = useMemo(
		() =>
			pinned
				.map((key) => visibleTiles.find((tile) => tile.key === key))
				.filter((tile): tile is TileDef => tile !== undefined),
		[pinned, visibleTiles]
	);

	const renderTile = (tile: TileDef) => {
		const isPinned = pinned.includes(tile.key);
		return (
			<Col key={tile.key} xs={24} sm={12} md={8} lg={6}>
				<div style={{ position: "relative", height: "100%" }}>
					<Tooltip title={isPinned ? t("dashboard.unpin") : t("dashboard.pin")}>
						<Button
							type="text"
							size="small"
							aria-label={isPinned ? t("dashboard.unpin") : t("dashboard.pin")}
							icon={
								isPinned ? (
									<PushpinFilled style={{ color: "#faad14" }} />
								) : (
									<PushpinOutlined />
								)
							}
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								togglePin(tile.key);
							}}
							style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
						/>
					</Tooltip>
					<Link
						to={tile.to}
						style={{
							textDecoration: "none",
							display: "block",
							height: "100%",
						}}
					>
						<Card
							hoverable
							styles={{ body: { padding: 16 } }}
							style={{
								height: "100%",
								cursor: "pointer",
								textAlign: "center",
							}}
						>
							<div style={{ fontSize: 32, color: tile.color, marginBottom: 8 }}>
								{tile.icon}
							</div>
							<Title level={5} style={{ marginBottom: 4 }}>
								{tile.title}
							</Title>
							<Typography.Text type="secondary" style={{ fontSize: 13 }}>
								{tile.description}
							</Typography.Text>
						</Card>
					</Link>
				</div>
			</Col>
		);
	};

	const renderSection = (sectionId: SectionId) => {
		const sectionTiles = visibleTiles.filter(
			(tile) => tile.section === sectionId && !pinned.includes(tile.key)
		);
		if (sectionTiles.length === 0) return null;
		return (
			<div key={sectionId} style={{ marginBottom: 48 }}>
				<Divider
					titlePlacement="start"
					style={{ marginTop: 0, marginBottom: 24 }}
				>
					{t(`dashboard.sections.${sectionId}`)}
				</Divider>
				<Row gutter={[16, 16]}>{sectionTiles.map(renderTile)}</Row>
			</div>
		);
	};

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

			{needsReassignment > 0 && (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 24 }}
					title={t("agencyReferrals:needsReassignmentBanner", {
						count: needsReassignment,
					})}
					action={
						<Link to="/referrals?filter=needs_reassignment">
							<Button size="small">
								{t("agencyReferrals:reviewOpenings")}
							</Button>
						</Link>
					}
				/>
			)}

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
				<>
					{pinnedTiles.length > 0 && (
						<div style={{ marginBottom: 48 }}>
							<Divider
								titlePlacement="start"
								style={{ marginTop: 0, marginBottom: 24 }}
							>
								{t("dashboard.sections.pinned")}
							</Divider>
							<Row gutter={[16, 16]}>{pinnedTiles.map(renderTile)}</Row>
						</div>
					)}
					{SECTION_ORDER.map(renderSection)}
				</>
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
