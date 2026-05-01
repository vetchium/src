import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Spin, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	MarketplaceClient,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

const SUB_STATUS_COLORS: Record<MarketplaceSubscriptionStatus, string> = {
	active: "success",
	cancelled: "error",
	expired: "warning",
};

export function MyClientsPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();

	const [clients, setClients] = useState<MarketplaceClient[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();

	const loadClients = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(`${baseUrl}/org/marketplace/list-clients`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						...(paginationKey ? { pagination_key: paginationKey } : {}),
						limit: 20,
					}),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					if (paginationKey) {
						setClients((prev) => [...prev, ...(data.clients || [])]);
					} else {
						setClients(data.clients || []);
					}
					setNextKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken]
	);

	useEffect(() => {
		loadClients();
	}, [loadClients]);

	const columns = [
		{
			title: t("clients.consumerDomain"),
			dataIndex: "consumer_org_domain",
			key: "consumer_org_domain",
		},
		{
			title: t("clients.listingNumber"),
			dataIndex: "listing_number",
			key: "listing_number",
			render: (num: number) => <span>#{num}</span>,
		},
		{
			title: t("clients.status"),
			dataIndex: "status",
			key: "status",
			render: (status: MarketplaceSubscriptionStatus) => (
				<Tag color={SUB_STATUS_COLORS[status]}>{t(`subStatus.${status}`)}</Tag>
			),
		},
		{
			title: t("clients.subscribedAt"),
			dataIndex: "started_at",
			key: "started_at",
			render: (v: string) => new Date(v).toLocaleDateString(),
		},
		{
			title: t("clients.actions"),
			key: "actions",
			render: (_: unknown, _record: MarketplaceClient) => (
				<Button size="small" onClick={() => navigate(`/marketplace/listings`)}>
					{t("clients.viewListing")}
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
				{t("clients.title")}
			</Title>

			<Spin spinning={loading}>
				<Table
					dataSource={clients}
					columns={columns}
					rowKey="subscription_id"
					pagination={false}
					footer={() =>
						nextKey ? (
							<div style={{ textAlign: "center" }}>
								<Button onClick={() => loadClients(nextKey)}>
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
