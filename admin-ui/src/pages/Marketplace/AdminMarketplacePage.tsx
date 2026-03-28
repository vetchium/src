import {
	ArrowLeftOutlined,
	CheckCircleOutlined,
	EyeOutlined,
	StopOutlined,
	WarningOutlined,
} from "@ant-design/icons";
import {
	App,
	Button,
	Checkbox,
	Descriptions,
	Form,
	Input,
	InputNumber,
	Modal,
	Select,
	Space,
	Spin,
	Table,
	Tabs,
	Tag,
	Tooltip,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	OrgCapability,
	OrgCapabilityStatus,
	ServiceListing,
	ServiceListingState,
	ListMarketplaceProviderCapabilitiesResponse,
	AdminListMarketplaceServiceListingsResponse,
} from "vetchium-specs/admin/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text } = Typography;
const { TextArea } = Input;

const REGIONS = ["ind1", "usa1", "deu1"] as const;
type Region = (typeof REGIONS)[number];

// ---- Capability status colors ----
function capabilityStatusColor(status: OrgCapabilityStatus): string {
	switch (status) {
		case "pending_approval":
			return "gold";
		case "active":
			return "green";
		case "rejected":
			return "red";
		case "expired":
			return "orange";
		case "revoked":
			return "volcano";
		default:
			return "default";
	}
}

// ---- Listing state colors ----
function listingStateColor(state: ServiceListingState): string {
	switch (state) {
		case "draft":
			return "default";
		case "pending_review":
			return "gold";
		case "active":
			return "green";
		case "paused":
			return "blue";
		case "rejected":
			return "red";
		case "suspended":
			return "volcano";
		case "appealing":
			return "purple";
		case "archived":
			return "gray";
		default:
			return "default";
	}
}

// ---- Types for modals ----
type CapabilityAction = "approve" | "reject" | "renew" | "revoke" | "reinstate";
type ListingAction =
	| "approve"
	| "reject"
	| "suspend"
	| "reinstate"
	| "grantAppeal"
	| "denyAppeal";

interface SelectedListing {
	listing: ServiceListing;
	homeRegion: Region;
}

// ============================================================
// Provider Capabilities Tab
// ============================================================
function CapabilitiesTab() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [capabilities, setCapabilities] = useState<OrgCapability[]>([]);
	const [loading, setLoading] = useState(true);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [filterStatus, setFilterStatus] = useState<
		OrgCapabilityStatus | "all"
	>("all");

	const [actionModal, setActionModal] = useState<{
		visible: boolean;
		action: CapabilityAction;
		capability: OrgCapability | null;
	}>({ visible: false, action: "approve", capability: null });
	const [submitting, setSubmitting] = useState(false);

	const [approveForm] = Form.useForm();
	const [rejectForm] = Form.useForm();
	const [renewForm] = Form.useForm();
	const [revokeForm] = Form.useForm();
	const [reinstateForm] = Form.useForm();

	const getActiveForm = () => {
		switch (actionModal.action) {
			case "approve":
				return approveForm;
			case "reject":
				return rejectForm;
			case "renew":
				return renewForm;
			case "revoke":
				return revokeForm;
			case "reinstate":
				return reinstateForm;
		}
	};

	const fetchCapabilities = useCallback(
		async (cursor: string | null = null, status: OrgCapabilityStatus | "all" = filterStatus) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: Record<string, unknown> = {};
				if (status !== "all") {
					body.filter_status = status;
				}
				if (cursor) {
					body.cursor = cursor;
				}

				const response = await fetch(
					`${apiBaseUrl}/admin/list-marketplace-provider-capabilities`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(body),
					}
				);

				if (response.status === 401) {
					message.error(t("capability.errors.loadFailed"));
					return;
				}
				if (response.status === 403) {
					message.error(t("capability.errors.loadFailed"));
					return;
				}
				if (response.status !== 200) {
					message.error(t("capability.errors.loadFailed"));
					return;
				}

				const data: ListMarketplaceProviderCapabilitiesResponse =
					await response.json();

				if (cursor === null) {
					setCapabilities(data.capabilities);
				} else {
					setCapabilities((prev) => [...prev, ...data.capabilities]);
				}
				if (data.next_cursor) {
					setNextCursor(data.next_cursor);
					setHasMore(true);
				} else {
					setNextCursor(null);
					setHasMore(false);
				}
			} catch {
				message.error(t("capability.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, filterStatus, t, message]
	);

	useEffect(() => {
		fetchCapabilities(null, filterStatus);
	}, [fetchCapabilities, filterStatus]);

	const handleFilterChange = (value: OrgCapabilityStatus | "all") => {
		setFilterStatus(value);
		setNextCursor(null);
		// fetchCapabilities will run via useEffect dependency change
	};

	const openModal = (action: CapabilityAction, cap: OrgCapability) => {
		setActionModal({ visible: true, action, capability: cap });
		// Reset the relevant form
		switch (action) {
			case "approve":
				approveForm.resetFields();
				break;
			case "reject":
				rejectForm.resetFields();
				break;
			case "renew":
				renewForm.resetFields();
				break;
			case "revoke":
				revokeForm.resetFields();
				break;
			case "reinstate":
				reinstateForm.resetFields();
				break;
		}
	};

	const closeModal = () => {
		setActionModal({ visible: false, action: "approve", capability: null });
	};

	const handleSubmit = async () => {
		const cap = actionModal.capability;
		if (!cap) return;

		const form = getActiveForm();
		let values: Record<string, unknown>;
		try {
			values = await form.validateFields();
		} catch {
			return;
		}

		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			let endpoint = "";
			let body: Record<string, unknown> = { org_id: cap.org_id };
			let successKey = "";
			let errorKey = "";

			switch (actionModal.action) {
				case "approve":
					endpoint = "/admin/approve-marketplace-provider-capability";
					body = {
						org_id: cap.org_id,
						subscription_price: values.subscription_price,
						currency: values.currency,
						subscription_period_days: values.subscription_period_days,
					};
					successKey = "capability.success.approved";
					errorKey = "capability.errors.approveFailed";
					break;
				case "reject":
					endpoint = "/admin/reject-marketplace-provider-capability";
					body = { org_id: cap.org_id, admin_note: values.admin_note };
					successKey = "capability.success.rejected";
					errorKey = "capability.errors.rejectFailed";
					break;
				case "renew":
					endpoint = "/admin/renew-marketplace-provider-capability";
					body = {
						org_id: cap.org_id,
						subscription_price: values.subscription_price,
						currency: values.currency,
						subscription_period_days: values.subscription_period_days,
					};
					successKey = "capability.success.renewed";
					errorKey = "capability.errors.renewFailed";
					break;
				case "revoke":
					endpoint = "/admin/revoke-marketplace-provider-capability";
					body = { org_id: cap.org_id, admin_note: values.admin_note };
					successKey = "capability.success.revoked";
					errorKey = "capability.errors.revokeFailed";
					break;
				case "reinstate":
					endpoint = "/admin/reinstate-marketplace-provider-capability";
					body = {
						org_id: cap.org_id,
						subscription_price: values.subscription_price,
						currency: values.currency,
						subscription_period_days: values.subscription_period_days,
					};
					successKey = "capability.success.reinstated";
					errorKey = "capability.errors.reinstateFailed";
					break;
			}

			const response = await fetch(`${apiBaseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});

			if (response.status === 422) {
				message.error(t("capability.errors.invalidState"));
				return;
			}
			if (response.status === 401) {
				message.error(t(errorKey));
				return;
			}
			if (response.status === 403) {
				message.error(t(errorKey));
				return;
			}
			if (response.status !== 200) {
				message.error(t(errorKey));
				return;
			}

			message.success(t(successKey));
			closeModal();
			fetchCapabilities(null, filterStatus);
		} catch {
			message.error(t("capability.errors.approveFailed"));
		} finally {
			setSubmitting(false);
		}
	};

	const columns = [
		{
			title: t("capability.table.orgId"),
			dataIndex: "org_id",
			key: "org_id",
			render: (id: string) => (
				<Tooltip title={id}>
					<Text style={{ fontFamily: "monospace" }}>
						{id.slice(0, 8)}...
					</Text>
				</Tooltip>
			),
		},
		{
			title: t("capability.table.capability"),
			dataIndex: "capability",
			key: "capability",
		},
		{
			title: t("capability.table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: OrgCapabilityStatus) => (
				<Tag color={capabilityStatusColor(status)}>
					{t(`capability.statuses.${status}`)}
				</Tag>
			),
		},
		{
			title: t("capability.table.appliedAt"),
			dataIndex: "applied_at",
			key: "applied_at",
			render: (v: string | undefined) => (v ? formatDateTime(v) : "-"),
		},
		{
			title: t("capability.table.grantedAt"),
			dataIndex: "granted_at",
			key: "granted_at",
			render: (v: string | undefined) => (v ? formatDateTime(v) : "-"),
		},
		{
			title: t("capability.table.expiresAt"),
			dataIndex: "expires_at",
			key: "expires_at",
			render: (v: string | undefined) => (v ? formatDateTime(v) : "-"),
		},
		{
			title: t("capability.table.subscriptionPrice"),
			dataIndex: "subscription_price",
			key: "subscription_price",
			render: (v: string | undefined) => (v !== undefined ? v : "-"),
		},
		{
			title: t("capability.table.currency"),
			dataIndex: "currency",
			key: "currency",
			render: (v: string | undefined) => v ?? "-",
		},
		{
			title: t("capability.table.actions"),
			key: "actions",
			render: (_: unknown, record: OrgCapability) => (
				<Space wrap>
					{record.status === "pending_approval" && (
						<>
							<Button
								type="primary"
								icon={<CheckCircleOutlined />}
								size="small"
								onClick={() => openModal("approve", record)}
							>
								{t("capability.actions.approve")}
							</Button>
							<Button
								danger
								size="small"
								onClick={() => openModal("reject", record)}
							>
								{t("capability.actions.reject")}
							</Button>
						</>
					)}
					{record.status === "active" && (
						<>
							<Button
								size="small"
								onClick={() => openModal("renew", record)}
							>
								{t("capability.actions.renew")}
							</Button>
							<Button
								danger
								icon={<StopOutlined />}
								size="small"
								onClick={() => openModal("revoke", record)}
							>
								{t("capability.actions.revoke")}
							</Button>
						</>
					)}
					{record.status === "expired" && (
						<Button
							size="small"
							onClick={() => openModal("renew", record)}
						>
							{t("capability.actions.renew")}
						</Button>
					)}
					{record.status === "revoked" && (
						<Button
							type="primary"
							size="small"
							onClick={() => openModal("reinstate", record)}
						>
							{t("capability.actions.reinstate")}
						</Button>
					)}
				</Space>
			),
		},
	];

	const expandedRowRender = (record: OrgCapability) => {
		if (!record.application_note) return null;
		return (
			<div style={{ padding: "8px 16px" }}>
				<Text strong>{t("capability.applicationNote")}: </Text>
				<Text>{record.application_note}</Text>
			</div>
		);
	};

	// Modal title and form body based on action
	const modalTitle = actionModal.action
		? t(`capability.${actionModal.action}Modal.title`)
		: "";

	const renderModalContent = () => {
		const action = actionModal.action;
		if (action === "approve" || action === "renew" || action === "reinstate") {
			const modalKey =
				action === "approve"
					? "approveModal"
					: action === "renew"
						? "renewModal"
						: "reinstateModal";
			const formToUse =
				action === "approve"
					? approveForm
					: action === "renew"
						? renewForm
						: reinstateForm;
			return (
				<Form form={formToUse} layout="vertical">
					<Form.Item
						name="subscription_price"
						label={t(`capability.${modalKey}.subscriptionPrice`)}
						rules={[{ required: true }]}
					>
						<InputNumber min={0} style={{ width: "100%" }} />
					</Form.Item>
					<Form.Item
						name="currency"
						label={t(`capability.${modalKey}.currency`)}
						rules={[
							{ required: true },
							{ len: 3, message: "Currency must be 3 letters" },
						]}
					>
						<Input
							placeholder={t("capability.approveModal.currencyPlaceholder")}
							maxLength={3}
							style={{ textTransform: "uppercase" }}
						/>
					</Form.Item>
					<Form.Item
						name="subscription_period_days"
						label={t(`capability.${modalKey}.subscriptionPeriodDays`)}
						rules={[{ required: true }]}
					>
						<InputNumber min={1} style={{ width: "100%" }} />
					</Form.Item>
				</Form>
			);
		}

		if (action === "reject" || action === "revoke") {
			const modalKey = action === "reject" ? "rejectModal" : "revokeModal";
			const formToUse = action === "reject" ? rejectForm : revokeForm;
			return (
				<Form form={formToUse} layout="vertical">
					<Form.Item
						name="admin_note"
						label={t(`capability.${modalKey}.adminNote`)}
						rules={[{ required: true }]}
					>
						<TextArea
							rows={4}
							placeholder={t(`capability.${modalKey}.adminNotePlaceholder`)}
						/>
					</Form.Item>
				</Form>
			);
		}
		return null;
	};

	return (
		<div>
			<div style={{ marginBottom: 16 }}>
				<Select
					value={filterStatus}
					onChange={handleFilterChange}
					style={{ width: 200 }}
					options={[
						{ value: "all", label: t("capability.filter.all") },
						{
							value: "pending_approval",
							label: t("capability.filter.pending_approval"),
						},
						{ value: "active", label: t("capability.filter.active") },
						{ value: "rejected", label: t("capability.filter.rejected") },
						{ value: "expired", label: t("capability.filter.expired") },
						{ value: "revoked", label: t("capability.filter.revoked") },
					]}
				/>
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={capabilities}
					columns={columns}
					rowKey={(r) => `${r.org_id}-${r.capability}`}
					pagination={false}
					expandable={{
						expandedRowRender,
						rowExpandable: (record) => !!record.application_note,
					}}
				/>
				{hasMore && !loading && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button onClick={() => fetchCapabilities(nextCursor, filterStatus)}>
							{t("listings.loadMore")}
						</Button>
					</div>
				)}
			</Spin>

			<Modal
				title={modalTitle}
				open={actionModal.visible}
				onOk={handleSubmit}
				onCancel={closeModal}
				confirmLoading={submitting}
				okText={
					actionModal.action
						? t(`capability.${actionModal.action}Modal.submit`)
						: ""
				}
				okButtonProps={{
					danger:
						actionModal.action === "reject" || actionModal.action === "revoke",
				}}
			>
				<Spin spinning={submitting}>{renderModalContent()}</Spin>
			</Modal>
		</div>
	);
}

// ============================================================
// Service Listings Tab
// ============================================================
function ServiceListingsTab() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [listings, setListings] = useState<ServiceListing[]>([]);
	// We need to track home_region per listing since it's not in ServiceListing
	const [listingRegions, setListingRegions] = useState<Map<string, Region>>(
		new Map()
	);
	const [loading, setLoading] = useState(true);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [filterState, setFilterState] = useState<ServiceListingState | "all">(
		"all"
	);
	const [hasReports, setHasReports] = useState(false);

	const [actionModal, setActionModal] = useState<{
		visible: boolean;
		action: ListingAction;
		selected: SelectedListing | null;
	}>({ visible: false, action: "approve", selected: null });

	const [detailModal, setDetailModal] = useState<{
		visible: boolean;
		selected: SelectedListing | null;
	}>({ visible: false, selected: null });

	const [submitting, setSubmitting] = useState(false);

	const [approveForm] = Form.useForm();
	const [rejectForm] = Form.useForm();
	const [suspendForm] = Form.useForm();
	const [reinstateForm] = Form.useForm();
	const [grantAppealForm] = Form.useForm();
	const [denyAppealForm] = Form.useForm();

	const getFormForAction = (action: ListingAction) => {
		switch (action) {
			case "approve":
				return approveForm;
			case "reject":
				return rejectForm;
			case "suspend":
				return suspendForm;
			case "reinstate":
				return reinstateForm;
			case "grantAppeal":
				return grantAppealForm;
			case "denyAppeal":
				return denyAppealForm;
		}
	};

	const fetchListings = useCallback(
		async (
			cursor: string | null = null,
			state: ServiceListingState | "all" = filterState,
			reports: boolean = hasReports
		) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: Record<string, unknown> = {};
				if (state !== "all") {
					body.filter_state = state;
				}
				if (reports) {
					body.has_reports = true;
				}
				if (cursor) {
					body.cursor = cursor;
				}

				const response = await fetch(
					`${apiBaseUrl}/admin/list-admin-marketplace-service-listings`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(body),
					}
				);

				if (response.status === 401) {
					message.error(t("listings.errors.loadFailed"));
					return;
				}
				if (response.status === 403) {
					message.error(t("listings.errors.loadFailed"));
					return;
				}
				if (response.status !== 200) {
					message.error(t("listings.errors.loadFailed"));
					return;
				}

				const data: AdminListMarketplaceServiceListingsResponse =
					await response.json();

				const newListings = data.service_listings;

				if (cursor === null) {
					setListings(newListings);
					// Reset regions map for fresh load
					const regionsMap = new Map<string, Region>();
					newListings.forEach((l) => {
						// Default to ind1 as placeholder; admin will set region in action modals
						regionsMap.set(l.service_listing_id, "ind1");
					});
					setListingRegions(regionsMap);
				} else {
					setListings((prev) => [...prev, ...newListings]);
					setListingRegions((prev) => {
						const updated = new Map(prev);
						newListings.forEach((l) => {
							if (!updated.has(l.service_listing_id)) {
								updated.set(l.service_listing_id, "ind1");
							}
						});
						return updated;
					});
				}

				if (data.next_cursor) {
					setNextCursor(data.next_cursor);
					setHasMore(true);
				} else {
					setNextCursor(null);
					setHasMore(false);
				}
			} catch {
				message.error(t("listings.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, filterState, hasReports, t, message]
	);

	useEffect(() => {
		fetchListings(null, filterState, hasReports);
	}, [fetchListings, filterState, hasReports]);

	const openActionModal = (action: ListingAction, listing: ServiceListing) => {
		const homeRegion = listingRegions.get(listing.service_listing_id) ?? "ind1";
		setActionModal({
			visible: true,
			action,
			selected: { listing, homeRegion },
		});
		const form = getFormForAction(action);
		form.resetFields();
		// Pre-set the region field in the form
		form.setFieldsValue({ home_region: homeRegion });
	};

	const closeActionModal = () => {
		setActionModal({ visible: false, action: "approve", selected: null });
	};

	const openDetailModal = (listing: ServiceListing) => {
		const homeRegion = listingRegions.get(listing.service_listing_id) ?? "ind1";
		setDetailModal({ visible: true, selected: { listing, homeRegion } });
	};

	const closeDetailModal = () => {
		setDetailModal({ visible: false, selected: null });
	};

	const handleSubmit = async () => {
		const { action, selected } = actionModal;
		if (!selected) return;

		const form = getFormForAction(action);
		let values: Record<string, unknown>;
		try {
			values = await form.validateFields();
		} catch {
			return;
		}

		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const homeRegion = (values.home_region as Region) ?? selected.homeRegion;
			const listingId = selected.listing.service_listing_id;

			let endpoint = "";
			let body: Record<string, unknown> = {};
			let successKey = "";
			let errorKey = "";

			switch (action) {
				case "approve":
					endpoint = "/admin/approve-marketplace-service-listing";
					body = {
						service_listing_id: listingId,
						home_region: homeRegion,
						admin_verification_note: values.admin_verification_note,
						verification_id: values.verification_id,
					};
					successKey = "listings.success.approved";
					errorKey = "listings.errors.approveFailed";
					break;
				case "reject":
					endpoint = "/admin/reject-marketplace-service-listing";
					body = {
						service_listing_id: listingId,
						home_region: homeRegion,
						admin_verification_note: values.admin_verification_note,
					};
					if (values.verification_id) {
						body.verification_id = values.verification_id;
					}
					successKey = "listings.success.rejected";
					errorKey = "listings.errors.rejectFailed";
					break;
				case "suspend":
					endpoint = "/admin/suspend-marketplace-service-listing";
					body = {
						service_listing_id: listingId,
						home_region: homeRegion,
						admin_verification_note: values.admin_verification_note,
					};
					successKey = "listings.success.suspended";
					errorKey = "listings.errors.suspendFailed";
					break;
				case "reinstate":
					endpoint = "/admin/reinstate-marketplace-service-listing";
					body = {
						service_listing_id: listingId,
						home_region: homeRegion,
					};
					if (values.admin_note) {
						body.admin_note = values.admin_note;
					}
					successKey = "listings.success.reinstated";
					errorKey = "listings.errors.reinstateFailed";
					break;
				case "grantAppeal":
					endpoint = "/admin/grant-marketplace-appeal";
					body = {
						service_listing_id: listingId,
						home_region: homeRegion,
						admin_note: values.admin_note,
					};
					successKey = "listings.success.appealGranted";
					errorKey = "listings.errors.grantAppealFailed";
					break;
				case "denyAppeal":
					endpoint = "/admin/deny-marketplace-appeal";
					body = {
						service_listing_id: listingId,
						home_region: homeRegion,
						admin_note: values.admin_note,
					};
					successKey = "listings.success.appealDenied";
					errorKey = "listings.errors.denyAppealFailed";
					break;
			}

			const response = await fetch(`${apiBaseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});

			if (response.status === 422) {
				message.error(t("listings.errors.invalidState"));
				return;
			}
			if (response.status === 401) {
				message.error(t(errorKey));
				return;
			}
			if (response.status === 403) {
				message.error(t(errorKey));
				return;
			}
			if (response.status !== 200) {
				message.error(t(errorKey));
				return;
			}

			message.success(t(successKey));
			// Update the known region for this listing
			setListingRegions((prev) => {
				const updated = new Map(prev);
				updated.set(listingId, homeRegion);
				return updated;
			});
			closeActionModal();
			fetchListings(null, filterState, hasReports);
		} catch {
			message.error(t("listings.errors.approveFailed"));
		} finally {
			setSubmitting(false);
		}
	};

	const regionField = (form: ReturnType<typeof Form.useForm>[0]) => (
		<Form.Item
			name="home_region"
			label={t("listings.region")}
			rules={[{ required: true }]}
		>
			<Select
				options={REGIONS.map((r) => ({ value: r, label: r }))}
				onChange={(val: Region) => {
					// Also update the listingRegions map for the selected listing
					if (actionModal.selected) {
						setListingRegions((prev) => {
							const updated = new Map(prev);
							updated.set(
								actionModal.selected!.listing.service_listing_id,
								val
							);
							return updated;
						});
					}
					form.setFieldsValue({ home_region: val });
				}}
			/>
		</Form.Item>
	);

	const renderActionModalContent = () => {
		const action = actionModal.action;

		if (action === "approve") {
			return (
				<Form form={approveForm} layout="vertical">
					{regionField(approveForm)}
					<Form.Item
						name="admin_verification_note"
						label={t("listings.approveModal.verificationNote")}
						rules={[{ required: true }]}
					>
						<TextArea
							rows={3}
							placeholder={t(
								"listings.approveModal.verificationNotePlaceholder"
							)}
						/>
					</Form.Item>
					<Form.Item
						name="verification_id"
						label={t("listings.approveModal.verificationId")}
						rules={[{ required: true }]}
					>
						<Input
							placeholder={t(
								"listings.approveModal.verificationIdPlaceholder"
							)}
						/>
					</Form.Item>
				</Form>
			);
		}

		if (action === "reject") {
			return (
				<Form form={rejectForm} layout="vertical">
					{regionField(rejectForm)}
					<Form.Item
						name="admin_verification_note"
						label={t("listings.rejectModal.adminNote")}
						rules={[{ required: true }]}
					>
						<TextArea
							rows={3}
							placeholder={t("listings.rejectModal.adminNotePlaceholder")}
						/>
					</Form.Item>
					<Form.Item
						name="verification_id"
						label={t("listings.rejectModal.verificationId")}
					>
						<Input />
					</Form.Item>
				</Form>
			);
		}

		if (action === "suspend") {
			return (
				<Form form={suspendForm} layout="vertical">
					{regionField(suspendForm)}
					<Form.Item
						name="admin_verification_note"
						label={t("listings.suspendModal.adminNote")}
						rules={[{ required: true }]}
					>
						<TextArea
							rows={3}
							placeholder={t("listings.suspendModal.adminNotePlaceholder")}
						/>
					</Form.Item>
				</Form>
			);
		}

		if (action === "reinstate") {
			return (
				<Form form={reinstateForm} layout="vertical">
					{regionField(reinstateForm)}
					<Form.Item
						name="admin_note"
						label={t("listings.reinstateModal.adminNote")}
					>
						<TextArea rows={3} />
					</Form.Item>
				</Form>
			);
		}

		if (action === "grantAppeal") {
			return (
				<Form form={grantAppealForm} layout="vertical">
					{regionField(grantAppealForm)}
					<Form.Item
						name="admin_note"
						label={t("listings.grantAppealModal.adminNote")}
						rules={[{ required: true }]}
					>
						<TextArea
							rows={3}
							placeholder={t("listings.grantAppealModal.adminNotePlaceholder")}
						/>
					</Form.Item>
				</Form>
			);
		}

		if (action === "denyAppeal") {
			return (
				<Form form={denyAppealForm} layout="vertical">
					{regionField(denyAppealForm)}
					<Form.Item
						name="admin_note"
						label={t("listings.denyAppealModal.adminNote")}
						rules={[{ required: true }]}
					>
						<TextArea
							rows={3}
							placeholder={t("listings.denyAppealModal.adminNotePlaceholder")}
						/>
					</Form.Item>
				</Form>
			);
		}

		return null;
	};

	const columns = [
		{
			title: t("listings.table.name"),
			dataIndex: "name",
			key: "name",
		},
		{
			title: t("listings.table.orgId"),
			dataIndex: "org_id",
			key: "org_id",
			render: (id: string) => (
				<Tooltip title={id}>
					<Text style={{ fontFamily: "monospace" }}>{id.slice(0, 8)}...</Text>
				</Tooltip>
			),
		},
		{
			title: t("listings.table.category"),
			dataIndex: "service_category",
			key: "service_category",
			render: (cat: string) =>
				t(`listings.categories.${cat}`, { defaultValue: cat }),
		},
		{
			title: t("listings.table.state"),
			dataIndex: "state",
			key: "state",
			render: (state: ServiceListingState) => (
				<Tag color={listingStateColor(state)}>
					{t(`listings.states.${state}`)}
				</Tag>
			),
		},
		{
			title: t("listings.table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v),
		},
		{
			title: t("listings.table.actions"),
			key: "actions",
			render: (_: unknown, record: ServiceListing) => (
				<Space wrap>
					<Button
						icon={<EyeOutlined />}
						size="small"
						onClick={() => openDetailModal(record)}
					>
						{t("listings.actions.view")}
					</Button>
					{record.state === "pending_review" && (
						<>
							<Button
								type="primary"
								icon={<CheckCircleOutlined />}
								size="small"
								onClick={() => openActionModal("approve", record)}
							>
								{t("listings.actions.approve")}
							</Button>
							<Button
								danger
								size="small"
								onClick={() => openActionModal("reject", record)}
							>
								{t("listings.actions.reject")}
							</Button>
						</>
					)}
					{record.state === "active" && (
						<Button
							danger
							icon={<StopOutlined />}
							size="small"
							onClick={() => openActionModal("suspend", record)}
						>
							{t("listings.actions.suspend")}
						</Button>
					)}
					{record.state === "suspended" && (
						<Button
							type="primary"
							size="small"
							onClick={() => openActionModal("reinstate", record)}
						>
							{t("listings.actions.reinstate")}
						</Button>
					)}
					{record.state === "appealing" && (
						<>
							<Button
								type="primary"
								size="small"
								onClick={() => openActionModal("grantAppeal", record)}
							>
								{t("listings.actions.grantAppeal")}
							</Button>
							<Button
								danger
								size="small"
								onClick={() => openActionModal("denyAppeal", record)}
							>
								{t("listings.actions.denyAppeal")}
							</Button>
						</>
					)}
				</Space>
			),
		},
	];

	const actionModalTitle = actionModal.action
		? t(
				`listings.${
					actionModal.action === "grantAppeal"
						? "grantAppealModal"
						: actionModal.action === "denyAppeal"
							? "denyAppealModal"
							: `${actionModal.action}Modal`
				}.title`
			)
		: "";

	return (
		<div>
			<Space style={{ marginBottom: 16 }} wrap>
				<Select
					value={filterState}
					onChange={(val: ServiceListingState | "all") => {
						setFilterState(val);
						setNextCursor(null);
					}}
					style={{ width: 200 }}
					options={[
						{ value: "all", label: t("listings.filter.all") },
						{
							value: "pending_review",
							label: t("listings.filter.pending_review"),
						},
						{ value: "active", label: t("listings.filter.active") },
						{ value: "rejected", label: t("listings.filter.rejected") },
						{ value: "suspended", label: t("listings.filter.suspended") },
						{ value: "appealing", label: t("listings.filter.appealing") },
					]}
				/>
				<Checkbox
					checked={hasReports}
					onChange={(e) => {
						setHasReports(e.target.checked);
						setNextCursor(null);
					}}
				>
					<WarningOutlined style={{ marginRight: 4 }} />
					{t("listings.hasReports")}
				</Checkbox>
			</Space>

			<Spin spinning={loading}>
				<Table
					dataSource={listings}
					columns={columns}
					rowKey="service_listing_id"
					pagination={false}
				/>
				{hasMore && !loading && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button
							onClick={() => fetchListings(nextCursor, filterState, hasReports)}
						>
							{t("listings.loadMore")}
						</Button>
					</div>
				)}
			</Spin>

			{/* Action Modal */}
			<Modal
				title={actionModalTitle}
				open={actionModal.visible}
				onOk={handleSubmit}
				onCancel={closeActionModal}
				confirmLoading={submitting}
				okText={
					actionModal.action
						? t(
								`listings.${
									actionModal.action === "grantAppeal"
										? "grantAppealModal"
										: actionModal.action === "denyAppeal"
											? "denyAppealModal"
											: `${actionModal.action}Modal`
								}.submit`
							)
						: ""
				}
				okButtonProps={{
					danger:
						actionModal.action === "reject" ||
						actionModal.action === "suspend" ||
						actionModal.action === "denyAppeal",
				}}
			>
				<Spin spinning={submitting}>{renderActionModalContent()}</Spin>
			</Modal>

			{/* Detail Modal */}
			<Modal
				title={t("listings.detailModal.title")}
				open={detailModal.visible}
				onCancel={closeDetailModal}
				footer={
					<Button onClick={closeDetailModal}>{t("common:close", "Close")}</Button>
				}
				width={700}
			>
				{detailModal.selected && (
					<Descriptions bordered column={1} size="small">
						<Descriptions.Item label={t("listings.detailModal.name")}>
							{detailModal.selected.listing.name}
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.orgId")}>
							<Text style={{ fontFamily: "monospace" }}>
								{detailModal.selected.listing.org_id}
							</Text>
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.region")}>
							{detailModal.selected.homeRegion}
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.category")}>
							{t(
								`listings.categories.${detailModal.selected.listing.service_category}`,
								{ defaultValue: detailModal.selected.listing.service_category }
							)}
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.state")}>
							<Tag color={listingStateColor(detailModal.selected.listing.state)}>
								{t(`listings.states.${detailModal.selected.listing.state}`)}
							</Tag>
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.shortBlurb")}>
							{detailModal.selected.listing.short_blurb}
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.description")}>
							<div style={{ whiteSpace: "pre-wrap" }}>
								{detailModal.selected.listing.description}
							</div>
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.contactUrl")}>
							<a
								href={detailModal.selected.listing.contact_url}
								target="_blank"
								rel="noopener noreferrer"
							>
								{detailModal.selected.listing.contact_url}
							</a>
						</Descriptions.Item>
						{detailModal.selected.listing.pricing_info && (
							<Descriptions.Item label={t("listings.detailModal.pricingInfo")}>
								{detailModal.selected.listing.pricing_info}
							</Descriptions.Item>
						)}
						<Descriptions.Item
							label={t("listings.detailModal.countriesOfService")}
						>
							{detailModal.selected.listing.countries_of_service.join(", ")}
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.appealExhausted")}>
							{detailModal.selected.listing.appeal_exhausted ? "Yes" : "No"}
						</Descriptions.Item>
						{detailModal.selected.listing.last_review_admin_note && (
							<Descriptions.Item
								label={t("listings.detailModal.lastReviewNote")}
							>
								{detailModal.selected.listing.last_review_admin_note}
							</Descriptions.Item>
						)}
						{detailModal.selected.listing.appeal_reason && (
							<Descriptions.Item label={t("listings.detailModal.appealReason")}>
								{detailModal.selected.listing.appeal_reason}
							</Descriptions.Item>
						)}
						{detailModal.selected.listing.appeal_admin_note && (
							<Descriptions.Item label={t("listings.detailModal.appealNote")}>
								{detailModal.selected.listing.appeal_admin_note}
							</Descriptions.Item>
						)}
						<Descriptions.Item label={t("listings.detailModal.createdAt")}>
							{formatDateTime(detailModal.selected.listing.created_at)}
						</Descriptions.Item>
						<Descriptions.Item label={t("listings.detailModal.updatedAt")}>
							{formatDateTime(detailModal.selected.listing.updated_at)}
						</Descriptions.Item>
					</Descriptions>
				)}
			</Modal>
		</div>
	);
}

// ============================================================
// Main Page
// ============================================================
export function AdminMarketplacePage() {
	const { t } = useTranslation("marketplace");

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
				{t("title")}
			</Title>

			<Tabs
				defaultActiveKey="capabilities"
				items={[
					{
						key: "capabilities",
						label: t("capabilitiesTab"),
						children: <CapabilitiesTab />,
					},
					{
						key: "listings",
						label: t("listingsTab"),
						children: <ServiceListingsTab />,
					},
				]}
			/>
		</div>
	);
}
