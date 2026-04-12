import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import {
	Alert,
	Button,
	Segmented,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { getApiBaseUrl } from "../../config";
import type {
	ListSubscriptionsRequest,
	ListSubscriptionsResponse,
	MarketplaceSubscription,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";

const { Title, Text } = Typography;

const subscriptionStatusColors: Record<MarketplaceSubscriptionStatus, string> =
	{
		active: "green",
		cancelled: "red",
		expired: "default",
	};

export function MarketplaceSubscriptionsPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();

	const [subscriptions, setSubscriptions] = useState<MarketplaceSubscription[]>(
		[]
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [paginationKey, setPaginationKey] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);
	const [filterMode, setFilterMode] = useState<"all" | "active" | "historical">(
		"all"
	);

	const fetchSubscriptions = useCallback(
		async (
			cursor: string | null,
			append: boolean,
			mode: "all" | "active" | "historical" = "all"
		) => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const includeHistorical =
					mode === "historical" ? true : mode === "active" ? false : undefined;
				const reqBody: ListSubscriptionsRequest = {
					limit: 20,
					...(cursor && { pagination_key: cursor }),
					...(includeHistorical !== undefined && {
						include_historical: includeHistorical,
					}),
				};
				const resp = await fetch(
					`${apiBaseUrl}/org/marketplace/subscriptions/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(reqBody),
					}
				);
				if (resp.status === 200) {
					const data: ListSubscriptionsResponse = await resp.json();
					setSubscriptions((prev) =>
						append ? [...prev, ...data.subscriptions] : data.subscriptions
					);
					setPaginationKey(data.next_pagination_key ?? null);
					setError(null);
				} else {
					setError(t("subscriptions.errors.loadFailed"));
				}
			} catch {
				setError(t("subscriptions.errors.loadFailed"));
			} finally {
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[sessionToken, t]
	);

	useEffect(() => {
		fetchSubscriptions(null, false, filterMode);
	}, [fetchSubscriptions, filterMode]);

	const columns: TableColumnsType<MarketplaceSubscription> = [
		{
			title: t("subscriptions.columns.provider"),
			dataIndex: "provider_org_domain",
			key: "provider_org_domain",
		},
		{
			title: t("subscriptions.columns.capability"),
			dataIndex: "capability_id",
			key: "capability_id",
			render: (id: string) => <Tag color="blue">{id}</Tag>,
		},
		{
			title: t("subscriptions.columns.status"),
			dataIndex: "status",
			key: "status",
			render: (status: MarketplaceSubscriptionStatus) => (
				<Tag color={subscriptionStatusColors[status]}>
					{t(`subscriptions.statuses.${status}`)}
				</Tag>
			),
		},
		{
			title: t("subscriptions.columns.startedAt"),
			dataIndex: "started_at",
			key: "started_at",
			render: (date: string) => new Date(date).toLocaleDateString(),
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

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("subscriptions.title")}
			</Title>

			<div style={{ marginBottom: 16 }}>
				<Segmented
					value={filterMode}
					onChange={(val) => {
						setFilterMode(val as "all" | "active" | "historical");
						setPaginationKey(null);
						setLoading(true);
					}}
					options={[
						{ label: t("subscriptions.filterAll"), value: "all" },
						{ label: t("subscriptions.filterActive"), value: "active" },
						{ label: t("subscriptions.filterHistorical"), value: "historical" },
					]}
				/>
			</div>

			{loading ? (
				<Spin size="large" />
			) : error ? (
				<Alert type="error" title={error} />
			) : (
				<>
					<Table
						dataSource={subscriptions}
						columns={columns}
						rowKey="subscription_id"
						pagination={false}
						onRow={(record) => ({
							onClick: () =>
								navigate(
									`/marketplace/subscriptions/${record.subscription_id}`
								),
							style: { cursor: "pointer" },
						})}
						locale={{
							emptyText: (
								<Text type="secondary">
									{t("subscriptions.noSubscriptions")}
								</Text>
							),
						}}
					/>
					{paginationKey && (
						<div style={{ textAlign: "center", marginTop: 16 }}>
							<Button
								onClick={() => {
									setLoadingMore(true);
									fetchSubscriptions(paginationKey, true, filterMode);
								}}
								loading={loadingMore}
							>
								{t("subscriptions.loadMore")}
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
