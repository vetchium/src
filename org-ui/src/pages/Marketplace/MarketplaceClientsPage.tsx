import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import { Alert, Button, Spin, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { getApiBaseUrl } from "../../config";
import type {
	ListClientsRequest,
	ListClientsResponse,
	MarketplaceClient,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";

const { Title, Text } = Typography;

const subscriptionStatusColors: Record<MarketplaceSubscriptionStatus, string> =
	{
		active: "green",
		cancelled: "red",
		expired: "default",
	};

export function MarketplaceClientsPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();

	const [clients, setClients] = useState<MarketplaceClient[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [paginationKey, setPaginationKey] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);

	const fetchClients = useCallback(
		async (cursor: string | null, append: boolean) => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const reqBody: ListClientsRequest = {
					limit: 20,
					...(cursor && { pagination_key: cursor }),
				};
				const resp = await fetch(`${apiBaseUrl}/org/marketplace/clients/list`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(reqBody),
				});
				if (resp.status === 200) {
					const data: ListClientsResponse = await resp.json();
					setClients((prev) =>
						append ? [...prev, ...data.clients] : data.clients
					);
					setPaginationKey(data.next_pagination_key ?? null);
					setError(null);
				} else {
					setError(t("clients.errors.loadFailed"));
				}
			} catch {
				setError(t("clients.errors.loadFailed"));
			} finally {
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[sessionToken, t]
	);

	useEffect(() => {
		fetchClients(null, false);
	}, [fetchClients]);

	const columns: TableColumnsType<MarketplaceClient> = [
		{
			title: t("clients.columns.consumer"),
			dataIndex: "consumer_org_domain",
			key: "consumer_org_domain",
		},
		{
			title: t("clients.columns.capability"),
			dataIndex: "capability_id",
			key: "capability_id",
			render: (id: string) => <Tag color="blue">{id}</Tag>,
		},
		{
			title: t("clients.columns.status"),
			dataIndex: "status",
			key: "status",
			render: (status: MarketplaceSubscriptionStatus) => (
				<Tag color={subscriptionStatusColors[status]}>
					{t(`clients.statuses.${status}`)}
				</Tag>
			),
		},
		{
			title: t("clients.columns.startedAt"),
			dataIndex: "started_at",
			key: "started_at",
			render: (date: string) => new Date(date).toLocaleDateString(),
		},
		{
			title: t("clients.columns.expiresAt"),
			dataIndex: "expires_at",
			key: "expires_at",
			render: (date?: string) =>
				date ? new Date(date).toLocaleDateString() : "—",
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

			{loading ? (
				<Spin size="large" />
			) : error ? (
				<Alert type="error" title={error} />
			) : (
				<>
					<Table
						dataSource={clients}
						columns={columns}
						rowKey="subscription_id"
						pagination={false}
						locale={{
							emptyText: <Text type="secondary">{t("clients.noClients")}</Text>,
						}}
					/>
					{paginationKey && (
						<div style={{ textAlign: "center", marginTop: 16 }}>
							<Button
								onClick={() => {
									setLoadingMore(true);
									fetchClients(paginationKey, true);
								}}
								loading={loadingMore}
							>
								{t("clients.loadMore")}
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
