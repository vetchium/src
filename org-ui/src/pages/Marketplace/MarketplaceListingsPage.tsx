import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import { Alert, Button, Space, Spin, Table, Tag, Typography } from "antd";
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
	PublishListingRequest,
	ArchiveListingRequest,
} from "vetchium-specs/org/marketplace";

const { Title, Text } = Typography;

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
	const [actionLoading, setActionLoading] = useState<string | null>(null);

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

	useEffect(() => {
		fetchListings(null, false);
	}, [fetchListings]);

	const handlePublish = async (listingId: string) => {
		if (!sessionToken) return;
		setActionLoading(listingId);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: PublishListingRequest = { listing_id: listingId };
			const resp = await fetch(
				`${apiBaseUrl}/org/marketplace/listings/publish`,
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
				fetchListings(null, false);
			}
		} finally {
			setActionLoading(null);
		}
	};

	const handleArchive = async (listingId: string) => {
		if (!sessionToken) return;
		setActionLoading(listingId);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: ArchiveListingRequest = { listing_id: listingId };
			const resp = await fetch(
				`${apiBaseUrl}/org/marketplace/listings/archive`,
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
				fetchListings(null, false);
			}
		} finally {
			setActionLoading(null);
		}
	};

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
						navigate(`/marketplace/listings/${record.listing_id}/edit`)
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
			title: t("listings.columns.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (date: string) => new Date(date).toLocaleDateString(),
		},
		...(canManage
			? [
					{
						title: t("listings.columns.actions"),
						key: "actions",
						render: (_: unknown, record: MarketplaceListing) => (
							<Space>
								{record.status === "draft" && (
									<Button
										size="small"
										type="primary"
										loading={actionLoading === record.listing_id}
										onClick={() => handlePublish(record.listing_id)}
									>
										{t("listings.publishButton")}
									</Button>
								)}
								{record.status === "active" && (
									<Button
										size="small"
										danger
										loading={actionLoading === record.listing_id}
										onClick={() => handleArchive(record.listing_id)}
									>
										{t("listings.archiveButton")}
									</Button>
								)}
								{(record.status === "draft" || record.status === "active") && (
									<Button
										size="small"
										onClick={() =>
											navigate(
												`/marketplace/listings/${record.listing_id}/edit`
											)
										}
									>
										{t("listings.editButton")}
									</Button>
								)}
							</Space>
						),
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
				{canManage && (
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
