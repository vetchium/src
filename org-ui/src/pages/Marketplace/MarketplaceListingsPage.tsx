import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import {
	Alert,
	Button,
	Card,
	Col,
	Row,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { getApiBaseUrl } from "../../config";
import type {
	ListMyListingsRequest,
	ListMyListingsResponse,
	MarketplaceListing,
	MarketplaceListingStatus,
	ListMarketplaceCapabilitiesRequest,
	ListMarketplaceCapabilitiesResponse,
	MarketplaceCapability,
} from "vetchium-specs/org/marketplace";

const { Title, Text, Paragraph } = Typography;

const listingStatusColors: Record<MarketplaceListingStatus, string> = {
	draft: "default",
	active: "green",
	suspended: "orange",
	archived: "red",
};

export function MarketplaceListingsPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const navigate = useNavigate();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_listings") ||
		false;

	const [listings, setListings] = useState<MarketplaceListing[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [paginationKey, setPaginationKey] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);

	const [capabilities, setCapabilities] = useState<MarketplaceCapability[]>([]);
	const [capabilitiesError, setCapabilitiesError] = useState<string | null>(
		null
	);

	const fetchListings = useCallback(
		async (cursor: string | null, append: boolean) => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const reqBody: ListMyListingsRequest = {
					limit: 20,
					...(cursor && { pagination_key: cursor }),
				};
				const resp = await fetch(
					`${apiBaseUrl}/org/marketplace/listings/list`,
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
					const data: ListMyListingsResponse = await resp.json();
					setListings((prev) =>
						append ? [...prev, ...data.listings] : data.listings
					);
					setPaginationKey(data.next_pagination_key ?? null);
					setError(null);
				} else {
					setError(t("listings.errors.loadFailed"));
				}
			} catch {
				setError(t("listings.errors.loadFailed"));
			} finally {
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[sessionToken, t]
	);

	const fetchCapabilities = useCallback(async () => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: ListMarketplaceCapabilitiesRequest = { limit: 50 };
			const resp = await fetch(
				`${apiBaseUrl}/org/marketplace/capabilities/list`,
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
				const data: ListMarketplaceCapabilitiesResponse = await resp.json();
				setCapabilities(data.capabilities);
			} else {
				setCapabilitiesError(t("listings.errors.capabilitiesLoadFailed"));
			}
		} catch {
			setCapabilitiesError(t("listings.errors.capabilitiesLoadFailed"));
		}
	}, [sessionToken, t]);

	useEffect(() => {
		fetchListings(null, false);
	}, [fetchListings]);

	useEffect(() => {
		// Only fetch capabilities when listings are done loading and empty
		if (!loading && listings.length === 0 && canManage) {
			fetchCapabilities();
		}
	}, [loading, listings.length, canManage, fetchCapabilities]);

	const columns: TableColumnsType<MarketplaceListing> = [
		{
			title: t("listings.columns.headline"),
			dataIndex: "headline",
			key: "headline",
			render: (text: string, record) => (
				<Button
					type="link"
					style={{ padding: 0 }}
					onClick={() =>
						navigate(`/marketplace/listings/${record.listing_id}`)
					}
				>
					{text}
				</Button>
			),
		},
		{
			title: t("listings.columns.capability"),
			dataIndex: "capability_id",
			key: "capability_id",
			render: (id: string) => <Tag color="blue">{id}</Tag>,
		},
		{
			title: t("listings.columns.status"),
			dataIndex: "status",
			key: "status",
			render: (status: MarketplaceListingStatus) => (
				<Tag color={listingStatusColors[status]}>
					{t(`listings.statuses.${status}`)}
				</Tag>
			),
		},
		{
			title: t("listings.columns.subscribers"),
			dataIndex: "active_subscriber_count",
			key: "active_subscriber_count",
		},
		{
			title: t("listings.columns.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (date: string) => new Date(date).toLocaleDateString(),
		},
	];

	const renderEmptyState = () => {
		if (capabilitiesError) {
			return <Alert type="error" title={capabilitiesError} />;
		}

		if (capabilities.length === 0) {
			return (
				<Text type="secondary">{t("listings.noListings")}</Text>
			);
		}

		return (
			<>
				<Paragraph style={{ marginBottom: 24 }}>
					{t("listings.emptyStateDescription")}
				</Paragraph>
				<Row gutter={[16, 16]}>
					{capabilities.map((cap) => (
						<Col key={cap.capability_id} xs={24} sm={12} lg={8}>
							<Card
								hoverable
								style={{ height: "100%" }}
								actions={
									canManage
										? [
												<Button
													type="primary"
													key="create"
													onClick={() =>
														navigate(
															`/marketplace/listings/new?capability=${cap.capability_id}`
														)
													}
												>
													{t("listings.emptyStateCreateButton")}
												</Button>,
											]
										: undefined
								}
							>
								<Card.Meta
									title={cap.display_name}
									description={
										<Paragraph
											ellipsis={{ rows: 3 }}
											style={{ marginBottom: 0 }}
										>
											{cap.description}
										</Paragraph>
									}
								/>
							</Card>
						</Col>
					))}
				</Row>
			</>
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
				{canManage && listings.length > 0 && (
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => navigate("/marketplace/listings/new")}
					>
						{t("listings.createButton")}
					</Button>
				)}
			</div>

			{loading ? (
				<Spin size="large" />
			) : error ? (
				<Alert type="error" title={error} />
			) : listings.length === 0 ? (
				renderEmptyState()
			) : (
				<>
					<Table
						dataSource={listings}
						columns={columns}
						rowKey="listing_id"
						pagination={false}
						locale={{
							emptyText: (
								<Text type="secondary">{t("listings.noListings")}</Text>
							),
						}}
					/>
					{paginationKey && (
						<div style={{ textAlign: "center", marginTop: 16 }}>
							<Button
								onClick={() => {
									setLoadingMore(true);
									fetchListings(paginationKey, true);
								}}
								loading={loadingMore}
							>
								{t("listings.loadMore")}
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
