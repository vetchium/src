import {
	ArrowLeftOutlined,
	EditOutlined,
	ExclamationCircleOutlined,
} from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import {
	Alert,
	Button,
	Card,
	Descriptions,
	Modal,
	Space,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { getApiBaseUrl } from "../../config";
import type {
	GetMyListingRequest,
	MarketplaceListing,
	MarketplaceListingStatus,
	PublishListingRequest,
	ArchiveListingRequest,
	ReopenListingRequest,
	ListClientsRequest,
	ListClientsResponse,
	MarketplaceClient,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";

const { Title, Text, Paragraph } = Typography;

const listingStatusColors: Record<MarketplaceListingStatus, string> = {
	draft: "default",
	active: "green",
	suspended: "orange",
	archived: "red",
};

const subscriptionStatusColors: Record<MarketplaceSubscriptionStatus, string> =
	{
		active: "green",
		cancelled: "red",
		expired: "default",
	};

export function MarketplaceListingDetailPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const navigate = useNavigate();
	const { listing_id } = useParams<{ listing_id: string }>();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_listings") ||
		false;

	const [listing, setListing] = useState<MarketplaceListing | null>(null);
	const [loadingListing, setLoadingListing] = useState(true);
	const [listingError, setListingError] = useState<string | null>(null);

	const [subscribers, setSubscribers] = useState<MarketplaceClient[]>([]);
	const [loadingSubscribers, setLoadingSubscribers] = useState(false);
	const [subscribersError, setSubscribersError] = useState<string | null>(null);
	const [subscribersPaginationKey, setSubscribersPaginationKey] = useState<
		string | null
	>(null);
	const [loadingMoreSubscribers, setLoadingMoreSubscribers] = useState(false);

	const [actionLoading, setActionLoading] = useState(false);
	const [confirmModal, setConfirmModal] = useState<
		"publish" | "archive" | "reopen" | null
	>(null);

	const fetchListing = useCallback(async () => {
		if (!sessionToken || !listing_id) return;
		setLoadingListing(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: GetMyListingRequest = { listing_id };
			const resp = await fetch(`${apiBaseUrl}/org/marketplace/listings/get`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(reqBody),
			});
			if (resp.status === 200) {
				const data: MarketplaceListing = await resp.json();
				setListing(data);
				setListingError(null);
			} else if (resp.status === 404) {
				setListingError(t("listingDetail.errors.loadFailed"));
			} else {
				setListingError(t("listingDetail.errors.loadFailed"));
			}
		} catch {
			setListingError(t("listingDetail.errors.loadFailed"));
		} finally {
			setLoadingListing(false);
		}
	}, [sessionToken, listing_id, t]);

	const fetchSubscribers = useCallback(
		async (cursor: string | null, append: boolean) => {
			if (!sessionToken || !listing_id) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const reqBody: ListClientsRequest = {
					listing_id,
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
					setSubscribers((prev) =>
						append ? [...prev, ...data.clients] : data.clients
					);
					setSubscribersPaginationKey(data.next_pagination_key ?? null);
					setSubscribersError(null);
				} else {
					setSubscribersError(t("listingDetail.errors.subscribersLoadFailed"));
				}
			} catch {
				setSubscribersError(t("listingDetail.errors.subscribersLoadFailed"));
			} finally {
				setLoadingSubscribers(false);
				setLoadingMoreSubscribers(false);
			}
		},
		[sessionToken, listing_id, t]
	);

	useEffect(() => {
		fetchListing();
	}, [fetchListing]);

	useEffect(() => {
		if (listing?.status === "active") {
			setLoadingSubscribers(true);
			fetchSubscribers(null, false);
		}
	}, [listing?.status, fetchSubscribers]);

	const performAction = async (action: "publish" | "archive" | "reopen") => {
		if (!sessionToken || !listing_id) return;
		setActionLoading(true);
		setConfirmModal(null);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const endpointMap = {
				publish: "/org/marketplace/listings/publish",
				archive: "/org/marketplace/listings/archive",
				reopen: "/org/marketplace/listings/reopen",
			};
			const body:
				| PublishListingRequest
				| ArchiveListingRequest
				| ReopenListingRequest = { listing_id };
			const resp = await fetch(`${apiBaseUrl}${endpointMap[action]}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			if (resp.status === 200) {
				fetchListing();
			}
		} finally {
			setActionLoading(false);
		}
	};

	const subscriberColumns: TableColumnsType<MarketplaceClient> = [
		{
			title: t("listingDetail.subscriberColumns.consumer"),
			dataIndex: "consumer_org_domain",
			key: "consumer_org_domain",
		},
		{
			title: t("listingDetail.subscriberColumns.since"),
			dataIndex: "started_at",
			key: "started_at",
			render: (date: string) => new Date(date).toLocaleDateString(),
		},
		{
			title: t("listingDetail.subscriberColumns.note"),
			key: "note",
			render: (_: unknown, record: MarketplaceClient) =>
				record.request_note ? (
					<Text type="secondary">{record.request_note}</Text>
				) : (
					<Text type="secondary" italic>
						—
					</Text>
				),
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
	];

	if (loadingListing) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
				<Spin size="large" />
			</div>
		);
	}

	if (listingError || !listing) {
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
					<Link to="/marketplace/listings">
						<Button icon={<ArrowLeftOutlined />}>
							{t("listingDetail.backToListings")}
						</Button>
					</Link>
				</div>
				<Alert type="error" title={listingError ?? ""} />
			</div>
		);
	}

	const confirmTitles = {
		publish: t("listingDetail.publishConfirmTitle"),
		archive: t("listingDetail.archiveConfirmTitle"),
		reopen: t("listingDetail.reopenConfirmTitle"),
	};

	const confirmMessages = {
		publish: t("listingDetail.publishConfirm"),
		archive: t("listingDetail.archiveConfirm"),
		reopen: t("listingDetail.reopenConfirm"),
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
				<Link to="/marketplace/listings">
					<Button icon={<ArrowLeftOutlined />}>
						{t("listingDetail.backToListings")}
					</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					marginBottom: 24,
				}}
			>
				<div>
					<Title level={2} style={{ margin: 0 }}>
						{listing.headline}
					</Title>
					<Space style={{ marginTop: 8 }}>
						<Tag color="blue">{listing.capability_id}</Tag>
						<Tag color={listingStatusColors[listing.status]}>
							{t(`listingDetail.statuses.${listing.status}`)}
						</Tag>
					</Space>
				</div>

				{canManage && (
					<Space>
						{(listing.status === "draft" || listing.status === "active") && (
							<Button
								icon={<EditOutlined />}
								onClick={() =>
									navigate(`/marketplace/listings/${listing.listing_id}/edit`)
								}
							>
								{t("listingDetail.editButton")}
							</Button>
						)}
						{listing.status === "draft" && (
							<Button
								type="primary"
								loading={actionLoading}
								onClick={() => setConfirmModal("publish")}
							>
								{t("listingDetail.publishButton")}
							</Button>
						)}
						{(listing.status === "active" ||
							listing.status === "suspended") && (
							<Button
								danger
								loading={actionLoading}
								onClick={() => setConfirmModal("archive")}
							>
								{t("listingDetail.archiveButton")}
							</Button>
						)}
						{listing.status === "archived" && (
							<Button
								loading={actionLoading}
								onClick={() => setConfirmModal("reopen")}
							>
								{t("listingDetail.reopenButton")}
							</Button>
						)}
					</Space>
				)}
			</div>

			{listing.status === "suspended" && (
				<Alert
					type="warning"
					icon={<ExclamationCircleOutlined />}
					style={{ marginBottom: 24 }}
					title={t("listingDetail.suspensionNote")}
					description={
						listing.suspension_note
							? listing.suspension_note
							: t("listingDetail.suspensionNoteHint")
					}
				/>
			)}

			<Card style={{ marginBottom: 24 }}>
				<Descriptions column={2}>
					<Descriptions.Item label={t("listingDetail.capability")}>
						{listing.capability_id}
					</Descriptions.Item>
					<Descriptions.Item label={t("listingDetail.status")}>
						<Tag color={listingStatusColors[listing.status]}>
							{t(`listingDetail.statuses.${listing.status}`)}
						</Tag>
					</Descriptions.Item>
					{listing.listed_at && (
						<Descriptions.Item label={t("listingDetail.listedAt")}>
							{new Date(listing.listed_at).toLocaleDateString()}
						</Descriptions.Item>
					)}
					<Descriptions.Item label={t("listingDetail.createdAt")}>
						{new Date(listing.created_at).toLocaleDateString()}
					</Descriptions.Item>
				</Descriptions>

				<div style={{ marginTop: 16 }}>
					<Text strong>{t("listingDetail.description")}</Text>
					<Paragraph style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
						{listing.description}
					</Paragraph>
				</div>
			</Card>

			{listing.status === "active" && (
				<Card title={t("listingDetail.subscribersTitle")}>
					{subscribersError ? (
						<Alert type="error" title={subscribersError} />
					) : loadingSubscribers ? (
						<Spin />
					) : (
						<>
							<Table
								dataSource={subscribers}
								columns={subscriberColumns}
								rowKey="subscription_id"
								pagination={false}
								locale={{
									emptyText: (
										<Text type="secondary">
											{t("listingDetail.noSubscribers")}
										</Text>
									),
								}}
							/>
							{subscribersPaginationKey && (
								<div style={{ textAlign: "center", marginTop: 16 }}>
									<Button
										onClick={() => {
											setLoadingMoreSubscribers(true);
											fetchSubscribers(subscribersPaginationKey, true);
										}}
										loading={loadingMoreSubscribers}
									>
										{t("listingDetail.loadMoreSubscribers")}
									</Button>
								</div>
							)}
						</>
					)}
				</Card>
			)}

			{confirmModal && (
				<Modal
					title={confirmTitles[confirmModal]}
					open={true}
					onOk={() => performAction(confirmModal)}
					onCancel={() => setConfirmModal(null)}
					confirmLoading={actionLoading}
				>
					{confirmMessages[confirmModal]}
				</Modal>
			)}
		</div>
	);
}
