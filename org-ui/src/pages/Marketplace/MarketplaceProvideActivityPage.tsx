import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Spin, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	ListIncomingSubscriptionsRequest,
	MarketplaceIncomingSubscription,
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

export function MarketplaceProvideActivityPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();
	const { capability_slug } = useParams<{ capability_slug: string }>();

	const [subscriptions, setSubscriptions] = useState<
		MarketplaceIncomingSubscription[]
	>([]);
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
				const req: ListIncomingSubscriptionsRequest = {
					limit: 20,
					...(capability_slug ? { capability_slug } : {}),
					...(paginationKey ? { pagination_key: paginationKey } : {}),
				};
				const resp = await fetch(
					`${baseUrl}/org/marketplace/incoming-subscriptions/list`,
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
					const items: MarketplaceIncomingSubscription[] =
						data.subscriptions ?? [];
					if (reset) {
						setSubscriptions(items);
					} else {
						setSubscriptions((prev) => [...prev, ...items]);
					}
					setNextPaginationKey(data.next_pagination_key ?? undefined);
				} else {
					message.error(t("provideActivity.errors.loadFailed"));
				}
			} catch {
				message.error(t("provideActivity.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, capability_slug, message, t]
	);

	useEffect(() => {
		loadSubscriptions(undefined, true);
	}, [loadSubscriptions]);

	const columns = [
		{
			title: t("provideActivity.consumer"),
			dataIndex: "consumer_org_domain",
			key: "consumer_org_domain",
		},
		{
			title: t("provideActivity.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={subscriptionStatusColor(status)}>
					{t(`provideActivity.subscriptionStatuses.${status}`)}
				</Tag>
			),
		},
		{
			title: t("provideActivity.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (createdAt: string) => new Date(createdAt).toLocaleString(),
		},
		{
			title: "",
			key: "actions",
			render: (_: unknown, record: MarketplaceIncomingSubscription) => (
				<Button
					size="small"
					onClick={() =>
						navigate(
							`/marketplace/provide/${record.capability_slug}/activity/${record.consumer_org_domain}`
						)
					}
				>
					{t("provideActivity.viewDetails")}
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
				<Link to={`/marketplace/provide/${capability_slug}`}>
					<Button icon={<ArrowLeftOutlined />}>
						{t("provideActivity.backToCapability")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("provideActivity.title")}
			</Title>

			<Spin spinning={loading}>
				<Table
					dataSource={subscriptions}
					columns={columns}
					rowKey={(record) =>
						`${record.consumer_org_domain}/${record.capability_slug}`
					}
					pagination={false}
					locale={{ emptyText: t("provideActivity.noSubscriptions") }}
				/>
			</Spin>

			{nextPaginationKey && (
				<Button
					onClick={() => loadSubscriptions(nextPaginationKey, false)}
					loading={loading}
					block
					style={{ marginTop: 16 }}
				>
					{t("provideActivity.loadMore")}
				</Button>
			)}
		</div>
	);
}
