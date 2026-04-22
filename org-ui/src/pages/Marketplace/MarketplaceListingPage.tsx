import {
	ArrowLeftOutlined,
	CheckOutlined,
	CloseOutlined,
	EditOutlined,
	InboxOutlined,
	SendOutlined,
	UndoOutlined,
} from "@ant-design/icons";
import {
	Alert,
	App,
	Button,
	Card,
	Descriptions,
	Divider,
	Form,
	Input,
	Modal,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	MarketplaceListing,
	MarketplaceListingStatus,
} from "vetchium-specs/org/marketplace";
import type { OrgPlan } from "vetchium-specs/org/tiers";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const STATUS_COLORS: Record<MarketplaceListingStatus, string> = {
	draft: "default",
	pending_review: "processing",
	active: "success",
	suspended: "warning",
	archived: "error",
};

export function MarketplaceListingPage() {
	const { t } = useTranslation("marketplace");
	const { orgDomain, listingNumber } = useParams<{
		orgDomain: string;
		listingNumber: string;
	}>();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const navigate = useNavigate();
	const { message } = App.useApp();

	const [listing, setListing] = useState<MarketplaceListing | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionLoading, setActionLoading] = useState(false);
	const [subscription, setSubscription] = useState<OrgPlan | null>(null);

	const [approveModalOpen, setApproveModalOpen] = useState(false);
	const [rejectModalOpen, setRejectModalOpen] = useState(false);
	const [rejectForm] = Form.useForm();

	const isSuperAdmin = myInfo?.roles.includes("org:superadmin") ?? false;

	const canManageListings =
		isSuperAdmin || myInfo?.roles.includes("org:manage_listings") || false;

	const canSubscribe =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_subscriptions") ||
		false;

	const loadListing = useCallback(async () => {
		if (!sessionToken || !orgDomain || !listingNumber) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/get`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					org_domain: orgDomain,
					listing_number: parseInt(listingNumber, 10),
				}),
			});
			if (resp.status === 200) {
				const data = await resp.json();
				setListing(data);
			} else if (resp.status === 404) {
				navigate("/marketplace/listings");
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, orgDomain, listingNumber, navigate]);

	useEffect(() => {
		loadListing();
	}, [loadListing]);

	useEffect(() => {
		if (!sessionToken) return;
		(async () => {
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(`${baseUrl}/org/org-plan/get`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({}),
				});
				if (resp.status === 200) setSubscription(await resp.json());
			} catch {
				// ignore — quota banner is best-effort
			}
		})();
	}, [sessionToken]);

	const listingsCap = subscription?.current_plan.marketplace_listings_cap;
	const atQuota =
		listingsCap !== undefined &&
		(listingsCap === 0 ||
			(subscription?.usage.marketplace_listings ?? 0) >= listingsCap);

	const handlePublish = async () => {
		if (!sessionToken || !listing) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/publish`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ listing_number: listing.listing_number }),
			});
			if (resp.status === 200) {
				message.success(t("listing.publishSuccess"));
				loadListing();
			} else if (resp.status === 403) {
				const payload = await resp.json();
				if (payload.quota) {
					message.error(
						t("quotaExceeded", {
							tier: payload.plan_id,
							cap: payload.current_cap,
						})
					);
				} else {
					message.error(t("listing.publishError"));
				}
			} else {
				message.error(t("listing.publishError"));
			}
		} finally {
			setActionLoading(false);
		}
	};

	const handleApprove = async () => {
		if (!sessionToken || !listing) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/approve`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ listing_number: listing.listing_number }),
			});
			if (resp.status === 200) {
				message.success(t("listing.approveSuccess"));
				setApproveModalOpen(false);
				loadListing();
			} else {
				message.error(t("listing.approveError"));
			}
		} finally {
			setActionLoading(false);
		}
	};

	const handleReject = async (values: { rejection_note: string }) => {
		if (!sessionToken || !listing) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/reject`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					listing_number: listing.listing_number,
					rejection_note: values.rejection_note,
				}),
			});
			if (resp.status === 200) {
				message.success(t("listing.rejectSuccess"));
				setRejectModalOpen(false);
				rejectForm.resetFields();
				loadListing();
			} else {
				message.error(t("listing.rejectError"));
			}
		} finally {
			setActionLoading(false);
		}
	};

	const handleArchive = async () => {
		if (!sessionToken || !listing) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/archive`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ listing_number: listing.listing_number }),
			});
			if (resp.status === 200) {
				message.success(t("listing.archiveSuccess"));
				loadListing();
			} else {
				message.error(t("listing.archiveError"));
			}
		} finally {
			setActionLoading(false);
		}
	};

	const handleReopen = async () => {
		if (!sessionToken || !listing) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/reopen`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ listing_number: listing.listing_number }),
			});
			if (resp.status === 200) {
				message.success(t("listing.reopenSuccess"));
				loadListing();
			} else {
				message.error(t("listing.reopenError"));
			}
		} finally {
			setActionLoading(false);
		}
	};

	const handleSubscribe = async () => {
		if (!sessionToken || !listing) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/subscription/subscribe`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						provider_org_domain: listing.org_domain,
						listing_number: listing.listing_number,
					}),
				}
			);
			if (resp.status === 201) {
				message.success(t("listing.subscribeSuccess"));
				navigate("/marketplace/subscriptions");
			} else if (resp.status === 409) {
				message.error(t("listing.alreadySubscribed"));
			} else if (resp.status === 422) {
				message.error(t("listing.selfSubscribeError"));
			} else {
				message.error(t("listing.subscribeError"));
			}
		} finally {
			setActionLoading(false);
		}
	};

	if (loading) {
		return (
			<div style={{ textAlign: "center", padding: 64 }}>
				<Spin size="large" />
			</div>
		);
	}

	if (!listing) {
		return null;
	}

	// Determine if this is the provider org's own listing
	// (we check by org_domain matching what is in the listing)
	const isOwnListing = myInfo?.org_domain === orgDomain;

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 900,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
					{t("listing.back")}
				</Button>
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
					<Text type="secondary">{listing.org_domain}</Text>
				</div>
				<Tag color={STATUS_COLORS[listing.status]}>
					{t(`status.${listing.status}`)}
				</Tag>
			</div>

			{listing.rejection_note && (
				<Card style={{ marginBottom: 24, borderColor: "#ff4d4f" }} size="small">
					<Text type="danger">
						<strong>{t("listing.rejectionNote")}:</strong>{" "}
						{listing.rejection_note}
					</Text>
				</Card>
			)}

			{listing.suspension_note && (
				<Card style={{ marginBottom: 24, borderColor: "#faad14" }} size="small">
					<Text type="warning">
						<strong>{t("listing.suspensionNote")}:</strong>{" "}
						{listing.suspension_note}
					</Text>
				</Card>
			)}

			<Card style={{ marginBottom: 24 }}>
				<Descriptions column={1} bordered size="small">
					<Descriptions.Item label={t("listing.listingNumber")}>
						#{listing.listing_number}
					</Descriptions.Item>
					<Descriptions.Item label={t("listing.capabilities")}>
						<Space wrap>
							{listing.capabilities.map((cap) => (
								<Tag key={cap} color="blue">
									{cap}
								</Tag>
							))}
						</Space>
					</Descriptions.Item>
					{listing.listed_at && (
						<Descriptions.Item label={t("listing.listedAt")}>
							{new Date(listing.listed_at).toLocaleDateString()}
						</Descriptions.Item>
					)}
					<Descriptions.Item label={t("listing.subscribers")}>
						{listing.active_subscriber_count}
					</Descriptions.Item>
					<Descriptions.Item label={t("listing.updatedAt")}>
						{new Date(listing.updated_at).toLocaleDateString()}
					</Descriptions.Item>
				</Descriptions>
			</Card>

			<Card title={t("listing.description")} style={{ marginBottom: 24 }}>
				<Paragraph style={{ whiteSpace: "pre-wrap" }}>
					{listing.description}
				</Paragraph>
			</Card>

			<Divider />

			{isOwnListing &&
				canManageListings &&
				listing.status === "draft" &&
				atQuota && (
					<Alert
						type="warning"
						showIcon
						style={{ marginBottom: 16 }}
						description={t("listing.publishQuotaTooltip", {
							tier: subscription?.current_plan.plan_id ?? "",
							cap: listingsCap,
						})}
						action={
							<Link to="/settings/plan">
								<Button size="small" type="primary">
									{t("create.upgradePlan")}
								</Button>
							</Link>
						}
					/>
				)}

			<Space wrap>
				{/* Provider actions */}
				{isOwnListing && canManageListings && listing.status === "draft" && (
					<>
						<Button
							icon={<EditOutlined />}
							onClick={() =>
								navigate(
									`/marketplace/listings/${listing.org_domain}/${listing.listing_number}/edit`
								)
							}
						>
							{t("listing.edit")}
						</Button>
						<Button
							type="primary"
							icon={<SendOutlined />}
							loading={actionLoading}
							disabled={atQuota}
							onClick={handlePublish}
						>
							{isSuperAdmin ? t("listing.publishDirect") : t("listing.publish")}
						</Button>
					</>
				)}

				{isOwnListing &&
					canManageListings &&
					listing.status === "pending_review" && (
						<>
							<Button
								type="primary"
								icon={<CheckOutlined />}
								loading={actionLoading}
								onClick={() => setApproveModalOpen(true)}
							>
								{t("listing.approve")}
							</Button>
							<Button
								danger
								icon={<CloseOutlined />}
								loading={actionLoading}
								onClick={() => setRejectModalOpen(true)}
							>
								{t("listing.reject")}
							</Button>
						</>
					)}

				{isOwnListing && canManageListings && listing.status === "active" && (
					<>
						<Button
							icon={<EditOutlined />}
							onClick={() =>
								navigate(
									`/marketplace/listings/${listing.org_domain}/${listing.listing_number}/edit`
								)
							}
						>
							{t("listing.edit")}
						</Button>
						<Button
							icon={<InboxOutlined />}
							loading={actionLoading}
							onClick={handleArchive}
						>
							{t("listing.archive")}
						</Button>
					</>
				)}

				{isOwnListing && canManageListings && listing.status === "archived" && (
					<Button
						icon={<UndoOutlined />}
						loading={actionLoading}
						onClick={handleReopen}
					>
						{t("listing.reopen")}
					</Button>
				)}

				{/* Consumer actions — subscribe when active and not own listing */}
				{!isOwnListing && listing.status === "active" && canSubscribe && (
					<Button
						type="primary"
						loading={actionLoading}
						onClick={handleSubscribe}
					>
						{t("listing.subscribe")}
					</Button>
				)}
			</Space>

			{/* Approve modal */}
			<Modal
				open={approveModalOpen}
				title={t("listing.approveModal.title")}
				onOk={handleApprove}
				onCancel={() => setApproveModalOpen(false)}
				confirmLoading={actionLoading}
				okText={t("listing.approveModal.confirm")}
			>
				<p>{t("listing.approveModal.content")}</p>
			</Modal>

			{/* Reject modal */}
			<Modal
				open={rejectModalOpen}
				title={t("listing.rejectModal.title")}
				onOk={() => rejectForm.submit()}
				onCancel={() => {
					setRejectModalOpen(false);
					rejectForm.resetFields();
				}}
				confirmLoading={actionLoading}
				okText={t("listing.rejectModal.confirm")}
				okButtonProps={{ danger: true }}
			>
				<Form form={rejectForm} onFinish={handleReject} layout="vertical">
					<Form.Item
						name="rejection_note"
						label={t("listing.rejectModal.noteLabel")}
						rules={[
							{
								required: true,
								message: t("listing.rejectModal.noteRequired"),
							},
							{ max: 2000, message: t("listing.rejectModal.noteMax") },
						]}
					>
						<TextArea rows={4} maxLength={2000} showCount />
					</Form.Item>
				</Form>
			</Modal>
		</div>
	);
}
