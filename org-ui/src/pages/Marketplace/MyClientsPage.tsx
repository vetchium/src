import { ArrowLeftOutlined, SearchOutlined } from "@ant-design/icons";
import {
	Button,
	Col,
	Input,
	Row,
	Select,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	ListMyClientsRequest,
	ListMyClientsResponse,
	MarketplaceCapability,
	MarketplaceClient,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDate } from "../../utils/dateFormat";

const { Title } = Typography;

const SUB_STATUS_COLORS: Record<MarketplaceSubscriptionStatus, string> = {
	active: "success",
	cancelled: "error",
	expired: "warning",
};

export function MyClientsPage() {
	const { t, i18n } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();

	const [clients, setClients] = useState<MarketplaceClient[]>([]);
	const [capabilities, setCapabilities] = useState<MarketplaceCapability[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [capabilityFilter, setCapabilityFilter] = useState<string>("");
	const [consumerFilter, setConsumerFilter] = useState<string>("");

	const loadCapabilities = useCallback(async () => {
		if (!sessionToken) return;
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/list-capabilities`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({}),
			});
			if (resp.status === 200) {
				const data = await resp.json();
				setCapabilities(data.capabilities || []);
			}
		} catch {
			// non-fatal: capability filter simply won't have options
		}
	}, [sessionToken]);

	const loadClients = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListMyClientsRequest = {
					...(capabilityFilter
						? { filter_capability_id: capabilityFilter }
						: {}),
					...(consumerFilter ? { filter_consumer: consumerFilter } : {}),
					...(paginationKey ? { pagination_key: paginationKey } : {}),
					limit: 20,
				};
				const resp = await fetch(`${baseUrl}/org/marketplace/list-clients`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (resp.status === 200) {
					const data: ListMyClientsResponse = await resp.json();
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
		[sessionToken, capabilityFilter, consumerFilter]
	);

	useEffect(() => {
		loadCapabilities();
	}, [loadCapabilities]);

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
			render: (v: string) => formatDate(v, i18n.language),
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

			<Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
				<Col xs={24} sm={12}>
					<Select
						allowClear
						placeholder={t("clients.filterByCapability")}
						style={{ width: "100%" }}
						value={capabilityFilter || undefined}
						onChange={(val) => setCapabilityFilter(val || "")}
						options={capabilities.map((c) => ({
							value: c.capability_id,
							label: c.display_name,
						}))}
					/>
				</Col>
				<Col xs={24} sm={12}>
					<Input
						prefix={<SearchOutlined />}
						placeholder={t("clients.searchPlaceholder")}
						allowClear
						value={consumerFilter}
						onChange={(e) => setConsumerFilter(e.target.value)}
					/>
				</Col>
			</Row>

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
