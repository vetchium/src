import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Select, Spin, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	MarketplaceListing,
	MarketplaceListingStatus,
} from "vetchium-specs/org/marketplace";
import type { OrgPlan } from "vetchium-specs/org/tiers";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;

const STATUS_COLORS: Record<MarketplaceListingStatus, string> = {
	draft: "default",
	pending_review: "processing",
	active: "success",
	suspended: "warning",
	archived: "error",
};

export function MyListingsPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const navigate = useNavigate();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_listings") ||
		false;

	const [subscription, setSubscription] = useState<OrgPlan | null>(null);
	const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
	const [listings, setListings] = useState<MarketplaceListing[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [filterStatus, setFilterStatus] = useState<
		MarketplaceListingStatus | undefined
	>();

	useEffect(() => {
		if (!sessionToken) return;
		(async () => {
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(`${baseUrl}/org/org-plan/get`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({}),
				});
				if (resp.status === 200) setSubscription(await resp.json());
			} catch {
				// ignore — quota gating is best-effort in UI
			} finally {
				setSubscriptionLoaded(true);
			}
		})();
	}, [sessionToken]);

	const listingsCap = subscription?.current_plan.marketplace_listings_cap;
	const atQuota =
		listingsCap !== undefined &&
		(listingsCap === 0 ||
			(subscription?.usage.marketplace_listings ?? 0) >= listingsCap);
	const quotaTooltip =
		listingsCap === 0
			? t("listings.quotaTooltipZero", {
					tier: subscription?.current_plan.plan_id ?? "",
				})
			: t("listings.quotaTooltip", {
					tier: subscription?.current_plan.plan_id ?? "",
					cap: listingsCap,
				});

	const loadListings = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(`${baseUrl}/org/marketplace/listing/list`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						...(filterStatus ? { filter_status: filterStatus } : {}),
						...(paginationKey ? { pagination_key: paginationKey } : {}),
						limit: 20,
					}),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					if (paginationKey) {
						setListings((prev) => [...prev, ...(data.listings || [])]);
					} else {
						setListings(data.listings || []);
					}
					setNextKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, filterStatus]
	);

	useEffect(() => {
		loadListings();
	}, [loadListings]);

	const columns = [
		{
			title: t("listings.number"),
			dataIndex: "listing_number",
			key: "listing_number",
		},
		{
			title: t("listings.headline"),
			dataIndex: "headline",
			key: "headline",
			render: (text: string, record: MarketplaceListing) => (
				<Link
					to={`/marketplace/listings/${record.org_domain}/${record.listing_number}`}
				>
					{text}
				</Link>
			),
		},
		{
			title: t("listings.status"),
			dataIndex: "status",
			key: "status",
			render: (status: MarketplaceListingStatus) => (
				<Tag color={STATUS_COLORS[status]}>{t(`status.${status}`)}</Tag>
			),
		},
		{
			title: t("listings.updated"),
			dataIndex: "updated_at",
			key: "updated_at",
			render: (v: string) => new Date(v).toLocaleDateString(),
		},
		{
			title: t("listings.actions"),
			key: "actions",
			render: (_: unknown, record: MarketplaceListing) => (
				<Button
					size="small"
					onClick={() =>
						navigate(
							`/marketplace/listings/${record.org_domain}/${record.listing_number}`
						)
					}
				>
					{t("listings.view")}
				</Button>
			),
		},
	];

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 1200,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 24,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("listings.title")}
				</Title>
				{canManage &&
					(!subscriptionLoaded || atQuota ? (
						<Button
							type="primary"
							icon={<PlusOutlined />}
							disabled={atQuota}
							loading={!subscriptionLoaded}
						>
							{t("listings.create")}
						</Button>
					) : (
						<Link to="/marketplace/listings/new">
							<Button type="primary" icon={<PlusOutlined />}>
								{t("listings.create")}
							</Button>
						</Link>
					))}
			</div>

			{canManage && subscriptionLoaded && atQuota && (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 16 }}
					description={quotaTooltip}
					action={
						<Link to="/settings/plan">
							<Button size="small" type="primary">
								{t("create.upgradePlan")}
							</Button>
						</Link>
					}
				/>
			)}

			<div style={{ marginBottom: 16 }}>
				<Select
					allowClear
					placeholder={t("listings.filterByStatus")}
					style={{ width: 200 }}
					onChange={(val) =>
						setFilterStatus(val as MarketplaceListingStatus | undefined)
					}
					options={[
						{ value: "draft", label: t("status.draft") },
						{ value: "pending_review", label: t("status.pending_review") },
						{ value: "active", label: t("status.active") },
						{ value: "suspended", label: t("status.suspended") },
						{ value: "archived", label: t("status.archived") },
					]}
				/>
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={listings}
					columns={columns}
					rowKey="listing_id"
					pagination={false}
					footer={() =>
						nextKey ? (
							<div style={{ textAlign: "center" }}>
								<Button onClick={() => loadListings(nextKey)}>
									{t("loadMore")}
								</Button>
							</div>
						) : null
					}
				/>
			</Spin>
		</div>
	);
}
