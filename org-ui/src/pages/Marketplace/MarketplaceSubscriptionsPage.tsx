import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import {
	Alert,
	Button,
	Modal,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { getApiBaseUrl } from "../../config";
import type {
	ListSubscriptionsRequest,
	ListSubscriptionsResponse,
	MarketplaceSubscription,
	MarketplaceSubscriptionStatus,
	CancelSubscriptionRequest,
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
	const { data: myInfo } = useMyInfo(sessionToken);

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_subscriptions") ||
		false;

	const [subscriptions, setSubscriptions] = useState<
		MarketplaceSubscription[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [paginationKey, setPaginationKey] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);

	const [cancelTarget, setCancelTarget] = useState<string | null>(null);
	const [cancelling, setCancelling] = useState(false);

	const fetchSubscriptions = useCallback(
		async (cursor: string | null, append: boolean) => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const reqBody: ListSubscriptionsRequest = {
					limit: 20,
					...(cursor && { pagination_key: cursor }),
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
		fetchSubscriptions(null, false);
	}, [fetchSubscriptions]);

	const handleCancel = async () => {
		if (!sessionToken || !cancelTarget) return;
		setCancelling(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: CancelSubscriptionRequest = {
				subscription_id: cancelTarget,
			};
			const resp = await fetch(
				`${apiBaseUrl}/org/marketplace/subscriptions/cancel`,
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
				setCancelTarget(null);
				fetchSubscriptions(null, false);
			}
		} finally {
			setCancelling(false);
		}
	};

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
		...(canManage
			? [
					{
						title: t("subscriptions.columns.actions"),
						key: "actions",
						render: (_: unknown, record: MarketplaceSubscription) =>
							record.status === "active" ? (
								<Button
									size="small"
									danger
									onClick={() => setCancelTarget(record.subscription_id)}
								>
									{t("subscriptions.cancelButton")}
								</Button>
							) : null,
					},
				]
			: []),
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
					<Button icon={<ArrowLeftOutlined />}>
						{t("backToDashboard")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("subscriptions.title")}
			</Title>

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
									fetchSubscriptions(paginationKey, true);
								}}
								loading={loadingMore}
							>
								{t("subscriptions.loadMore")}
							</Button>
						</div>
					)}
				</>
			)}

			<Modal
				title={t("subscriptions.cancelTitle")}
				open={!!cancelTarget}
				onOk={handleCancel}
				onCancel={() => setCancelTarget(null)}
				confirmLoading={cancelling}
			>
				{t("subscriptions.cancelConfirm")}
			</Modal>
		</div>
	);
}
