import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Spin, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	ListConsumerSubscriptionsRequest,
	MarketplaceSubscription,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

function subscriptionStatusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "provider_review":
		case "admin_review":
		case "awaiting_contract":
		case "awaiting_payment":
		case "requested":
			return "gold";
		case "rejected":
		case "cancelled":
			return "red";
		case "expired":
			return "default";
		default:
			return "default";
	}
}

export function MarketplacePurchasesPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();

	const [subscriptions, setSubscriptions] = useState<MarketplaceSubscription[]>(
		[]
	);
	const [loading, setLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>(undefined);

	const loadSubscriptions = useCallback(
		async (paginationKey?: string, reset?: boolean) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListConsumerSubscriptionsRequest = {
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
				};
				const resp = await fetch(
					`${baseUrl}/org/marketplace/consumer-subscriptions/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(req),
					}
				);
				if (resp.status === 200) {
					const data = await resp.json();
					const items: MarketplaceSubscription[] = data.subscriptions ?? [];
					if (reset) {
						setSubscriptions(items);
					} else {
						setSubscriptions((prev) => [...prev, ...items]);
					}
					setNextPaginationKey(data.next_pagination_key ?? undefined);
				} else {
					message.error(t("purchases.errors.loadFailed"));
				}
			} catch {
				message.error(t("purchases.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	useEffect(() => {
		loadSubscriptions(undefined, true);
	}, [loadSubscriptions]);

	const columns = [
		{
			title: t("purchases.provider"),
			dataIndex: "provider_org_domain",
			key: "provider_org_domain",
		},
		{
			title: t("purchases.capability"),
			dataIndex: "capability_slug",
			key: "capability_slug",
		},
		{
			title: t("purchases.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={subscriptionStatusColor(status)}>
					{t(`purchases.subscriptionStatuses.${status}`)}
				</Tag>
			),
		},
		{
			title: t("purchases.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (createdAt: string) => new Date(createdAt).toLocaleString(),
		},
		{
			title: "",
			key: "actions",
			render: (_: unknown, record: MarketplaceSubscription) => (
				<Button
					size="small"
					onClick={() =>
						navigate(
							`/marketplace/purchases/from/${record.provider_org_domain}/${record.capability_slug}`
						)
					}
				>
					{t("purchases.viewDetails")}
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

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("purchases.title")}
			</Title>

			<Spin spinning={loading}>
				<Table
					dataSource={subscriptions}
					columns={columns}
					rowKey={(record) =>
						`${record.provider_org_domain}/${record.capability_slug}`
					}
					pagination={false}
					locale={{ emptyText: t("purchases.noSubscriptions") }}
				/>
			</Spin>

			{nextPaginationKey && (
				<Button
					onClick={() => loadSubscriptions(nextPaginationKey, false)}
					loading={loading}
					block
					style={{ marginTop: 16 }}
				>
					{t("purchases.loadMore")}
				</Button>
			)}
		</div>
	);
}
