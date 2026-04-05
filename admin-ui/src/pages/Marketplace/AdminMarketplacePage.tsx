import {
	ArrowLeftOutlined,
	CheckOutlined,
	CloseOutlined,
	PlusOutlined,
	StopOutlined,
	SyncOutlined,
} from "@ant-design/icons";
import {
	App,
	Button,
	Form,
	Input,
	Modal,
	Select,
	Space,
	Spin,
	Switch,
	Table,
	Tabs,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AdminMarketplaceCapability,
	AdminMarketplaceEnrollment,
	AdminMarketplaceOffer,
	AdminMarketplaceSubscription,
	AdminBillingRecord,
	AdminListCapabilitiesResponse,
	AdminListEnrollmentsResponse,
	AdminListOffersResponse,
	AdminListSubscriptionsResponse,
	AdminListBillingResponse,
	AdminCreateCapabilityRequest,
	AdminApproveEnrollmentRequest,
	AdminRejectEnrollmentRequest,
	AdminSuspendEnrollmentRequest,
	AdminRenewEnrollmentRequest,
	AdminApproveOfferRequest,
	AdminRejectOfferRequest,
	AdminSuspendOfferRequest,
	AdminApproveSubscriptionRequest,
	AdminRejectSubscriptionRequest,
	AdminMarkContractSignedRequest,
	AdminWaiveContractRequest,
	AdminRecordPaymentRequest,
	AdminWaivePaymentRequest,
} from "vetchium-specs/admin/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text } = Typography;
const { TextArea } = Input;

// ---- Helpers ----

function statusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "pending_approval":
		case "pending_review":
		case "pending":
			return "gold";
		case "rejected":
			return "red";
		case "suspended":
			return "volcano";
		case "expired":
			return "orange";
		case "disabled":
			return "default";
		case "cancelled":
			return "gray";
		default:
			return "blue";
	}
}

// ============================================================
// CAPABILITIES TAB
// ============================================================

interface CapabilitiesTabProps {
	sessionToken: string | null;
	canManage: boolean;
}

function CapabilitiesTab({ sessionToken, canManage }: CapabilitiesTabProps) {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();

	const [capabilities, setCapabilities] = useState<
		AdminMarketplaceCapability[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [hasMore, setHasMore] = useState(false);

	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [createLoading, setCreateLoading] = useState(false);
	const [createForm] = Form.useForm();

	const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
		{}
	);

	const fetchCapabilities = useCallback(
		async (reset = true) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: { pagination_key?: string; limit: number } = {
					limit: 50,
				};
				if (!reset && nextKey) {
					body.pagination_key = nextKey;
				}
				const resp = await fetch(
					`${apiBaseUrl}/admin/marketplace/capabilities/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(body),
					}
				);
				if (resp.status === 200) {
					const data: AdminListCapabilitiesResponse = await resp.json();
					if (reset) {
						setCapabilities(data.capabilities);
					} else {
						setCapabilities((prev) => [...prev, ...data.capabilities]);
					}
					setNextKey(data.next_pagination_key);
					setHasMore(!!data.next_pagination_key);
				} else {
					message.error(t("capabilities.errors.loadFailed"));
				}
			} catch {
				message.error(t("capabilities.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, nextKey, message, t]
	);

	useEffect(() => {
		fetchCapabilities(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionToken]);

	async function handleToggleStatus(
		capability: AdminMarketplaceCapability,
		enable: boolean
	) {
		const slug = capability.capability_slug;
		setActionLoading((prev) => ({ ...prev, [slug]: true }));
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const endpoint = enable
				? "/admin/marketplace/capabilities/enable"
				: "/admin/marketplace/capabilities/disable";
			const resp = await fetch(`${apiBaseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ capability_slug: slug }),
			});
			if (resp.status === 200 || resp.status === 204) {
				message.success(
					enable
						? t("capabilities.success.enabled")
						: t("capabilities.success.disabled")
				);
				fetchCapabilities(true);
			} else {
				message.error(
					enable
						? t("capabilities.errors.enableFailed")
						: t("capabilities.errors.disableFailed")
				);
			}
		} catch {
			message.error(t("capabilities.errors.enableFailed"));
		} finally {
			setActionLoading((prev) => ({ ...prev, [slug]: false }));
		}
	}

	async function handleCreate(values: AdminCreateCapabilityRequest) {
		setCreateLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${apiBaseUrl}/admin/marketplace/capabilities/create`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(values),
				}
			);
			if (resp.status === 200 || resp.status === 201) {
				message.success(t("capabilities.success.created"));
				setCreateModalOpen(false);
				createForm.resetFields();
				fetchCapabilities(true);
			} else if (resp.status === 409) {
				message.error(t("capabilities.errors.conflict"));
			} else {
				message.error(t("capabilities.errors.createFailed"));
			}
		} catch {
			message.error(t("capabilities.errors.createFailed"));
		} finally {
			setCreateLoading(false);
		}
	}

	const columns = [
		{
			title: t("capabilities.table.slug"),
			dataIndex: "capability_slug",
			key: "capability_slug",
		},
		{
			title: t("capabilities.table.displayName"),
			dataIndex: "display_name",
			key: "display_name",
		},
		{
			title: t("capabilities.table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={statusColor(status)}>{status}</Tag>
			),
		},
		{
			title: t("capabilities.table.providerEnabled"),
			dataIndex: "provider_enabled",
			key: "provider_enabled",
			render: (v: boolean) => (v ? t("yes") : t("no")),
		},
		{
			title: t("capabilities.table.consumerEnabled"),
			dataIndex: "consumer_enabled",
			key: "consumer_enabled",
			render: (v: boolean) => (v ? t("yes") : t("no")),
		},
		{
			title: t("capabilities.table.contractRequired"),
			dataIndex: "contract_required",
			key: "contract_required",
			render: (v: boolean) => (v ? t("yes") : t("no")),
		},
		{
			title: t("capabilities.table.paymentRequired"),
			dataIndex: "payment_required",
			key: "payment_required",
			render: (v: boolean) => (v ? t("yes") : t("no")),
		},
		{
			title: t("capabilities.table.updatedAt"),
			dataIndex: "updated_at",
			key: "updated_at",
			render: (v: string) => formatDateTime(v),
		},
		...(canManage
			? [
					{
						title: t("capabilities.table.actions"),
						key: "actions",
						render: (_: unknown, record: AdminMarketplaceCapability) => (
							<Space>
								{record.status === "active" ? (
									<Button
										size="small"
										icon={<StopOutlined />}
										danger
										loading={actionLoading[record.capability_slug]}
										onClick={() => handleToggleStatus(record, false)}
									>
										{t("capabilities.actions.disable")}
									</Button>
								) : (
									<Button
										size="small"
										icon={<CheckOutlined />}
										loading={actionLoading[record.capability_slug]}
										onClick={() => handleToggleStatus(record, true)}
									>
										{t("capabilities.actions.enable")}
									</Button>
								)}
							</Space>
						),
					},
				]
			: []),
	];

	return (
		<div>
			{canManage && (
				<div style={{ marginBottom: 16 }}>
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => setCreateModalOpen(true)}
					>
						{t("capabilities.createButton")}
					</Button>
				</div>
			)}
			<Spin spinning={loading}>
				<Table
					dataSource={capabilities}
					columns={columns}
					rowKey="capability_slug"
					pagination={false}
					size="small"
				/>
			</Spin>
			{hasMore && (
				<div style={{ marginTop: 16 }}>
					<Button onClick={() => fetchCapabilities(false)}>
						{t("loadMore")}
					</Button>
				</div>
			)}

			<Modal
				title={t("capabilities.createModal.title")}
				open={createModalOpen}
				onCancel={() => {
					setCreateModalOpen(false);
					createForm.resetFields();
				}}
				footer={null}
				width={600}
			>
				<Spin spinning={createLoading}>
					<Form
						form={createForm}
						layout="vertical"
						onFinish={handleCreate}
						initialValues={{
							provider_enabled: true,
							consumer_enabled: true,
							enrollment_approval: "manual",
							offer_review: "manual",
							subscription_approval: "admin",
							contract_required: false,
							payment_required: false,
						}}
					>
						<Form.Item
							name="capability_slug"
							label={t("capabilities.createModal.slug")}
							rules={[{ required: true }]}
						>
							<Input />
						</Form.Item>
						<Form.Item
							name="display_name"
							label={t("capabilities.createModal.displayName")}
							rules={[{ required: true }]}
						>
							<Input />
						</Form.Item>
						<Form.Item
							name="description"
							label={t("capabilities.createModal.description")}
							rules={[{ required: true }]}
						>
							<TextArea rows={3} />
						</Form.Item>
						<Form.Item
							name="enrollment_approval"
							label={t("capabilities.createModal.enrollmentApproval")}
							rules={[{ required: true }]}
						>
							<Select>
								<Select.Option value="open">{t("approval.open")}</Select.Option>
								<Select.Option value="manual">
									{t("approval.manual")}
								</Select.Option>
							</Select>
						</Form.Item>
						<Form.Item
							name="offer_review"
							label={t("capabilities.createModal.offerReview")}
							rules={[{ required: true }]}
						>
							<Select>
								<Select.Option value="auto">{t("review.auto")}</Select.Option>
								<Select.Option value="manual">
									{t("review.manual")}
								</Select.Option>
							</Select>
						</Form.Item>
						<Form.Item
							name="subscription_approval"
							label={t("capabilities.createModal.subscriptionApproval")}
							rules={[{ required: true }]}
						>
							<Select>
								<Select.Option value="direct">
									{t("subApproval.direct")}
								</Select.Option>
								<Select.Option value="provider">
									{t("subApproval.provider")}
								</Select.Option>
								<Select.Option value="admin">
									{t("subApproval.admin")}
								</Select.Option>
								<Select.Option value="provider_and_admin">
									{t("subApproval.providerAndAdmin")}
								</Select.Option>
							</Select>
						</Form.Item>
						<Form.Item
							name="provider_enabled"
							label={t("capabilities.createModal.providerEnabled")}
							valuePropName="checked"
						>
							<Switch />
						</Form.Item>
						<Form.Item
							name="consumer_enabled"
							label={t("capabilities.createModal.consumerEnabled")}
							valuePropName="checked"
						>
							<Switch />
						</Form.Item>
						<Form.Item
							name="contract_required"
							label={t("capabilities.createModal.contractRequired")}
							valuePropName="checked"
						>
							<Switch />
						</Form.Item>
						<Form.Item
							name="payment_required"
							label={t("capabilities.createModal.paymentRequired")}
							valuePropName="checked"
						>
							<Switch />
						</Form.Item>
						<Form.Item
							name="pricing_hint"
							label={t("capabilities.createModal.pricingHint")}
						>
							<Input />
						</Form.Item>
						<Form.Item>
							<Space>
								<Button type="primary" htmlType="submit">
									{t("capabilities.createModal.submit")}
								</Button>
								<Button
									onClick={() => {
										setCreateModalOpen(false);
										createForm.resetFields();
									}}
								>
									{t("cancel")}
								</Button>
							</Space>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}

// ============================================================
// ENROLLMENTS TAB
// ============================================================

interface EnrollmentsTabProps {
	sessionToken: string | null;
	canManage: boolean;
}

type EnrollmentAction =
	| "approve"
	| "reject"
	| "suspend"
	| "reinstate"
	| "renew";

interface EnrollmentModalState {
	action: EnrollmentAction;
	enrollment: AdminMarketplaceEnrollment;
}

function EnrollmentsTab({ sessionToken, canManage }: EnrollmentsTabProps) {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();

	const [enrollments, setEnrollments] = useState<AdminMarketplaceEnrollment[]>(
		[]
	);
	const [loading, setLoading] = useState(true);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [hasMore, setHasMore] = useState(false);
	const [filterStatus, setFilterStatus] = useState<string | undefined>();

	const [modalState, setModalState] = useState<EnrollmentModalState | null>(
		null
	);
	const [actionLoading, setActionLoading] = useState(false);
	const [actionForm] = Form.useForm();

	const fetchEnrollments = useCallback(
		async (reset = true, statusOverride?: string) => {
			setLoading(true);
			const status =
				statusOverride !== undefined ? statusOverride : filterStatus;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: {
					filter_status?: string;
					pagination_key?: string;
					limit: number;
				} = { limit: 50 };
				if (status) body.filter_status = status;
				if (!reset && nextKey) body.pagination_key = nextKey;
				const resp = await fetch(
					`${apiBaseUrl}/admin/marketplace/provider-enrollments/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(body),
					}
				);
				if (resp.status === 200) {
					const data: AdminListEnrollmentsResponse = await resp.json();
					if (reset) {
						setEnrollments(data.enrollments);
					} else {
						setEnrollments((prev) => [...prev, ...data.enrollments]);
					}
					setNextKey(data.next_pagination_key);
					setHasMore(!!data.next_pagination_key);
				} else {
					message.error(t("enrollments.errors.loadFailed"));
				}
			} catch {
				message.error(t("enrollments.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, nextKey, filterStatus, message, t]
	);

	useEffect(() => {
		fetchEnrollments(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionToken]);

	async function handleAction(values: Record<string, string>) {
		if (!modalState) return;
		setActionLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const { action, enrollment } = modalState;
			let endpoint = "";
			let body:
				| AdminApproveEnrollmentRequest
				| AdminRejectEnrollmentRequest
				| AdminSuspendEnrollmentRequest
				| { org_domain: string; capability_slug: string }
				| AdminRenewEnrollmentRequest;

			switch (action) {
				case "approve":
					endpoint = "/admin/marketplace/provider-enrollments/approve";
					body = {
						org_domain: enrollment.org_domain,
						capability_slug: enrollment.capability_slug,
						expires_at: values.expires_at || undefined,
						billing_reference: values.billing_reference || undefined,
						review_note: values.review_note || undefined,
					} as AdminApproveEnrollmentRequest;
					break;
				case "reject":
					endpoint = "/admin/marketplace/provider-enrollments/reject";
					body = {
						org_domain: enrollment.org_domain,
						capability_slug: enrollment.capability_slug,
						review_note: values.review_note,
					} as AdminRejectEnrollmentRequest;
					break;
				case "suspend":
					endpoint = "/admin/marketplace/provider-enrollments/suspend";
					body = {
						org_domain: enrollment.org_domain,
						capability_slug: enrollment.capability_slug,
						review_note: values.review_note,
					} as AdminSuspendEnrollmentRequest;
					break;
				case "reinstate":
					endpoint = "/admin/marketplace/provider-enrollments/reinstate";
					body = {
						org_domain: enrollment.org_domain,
						capability_slug: enrollment.capability_slug,
					};
					break;
				case "renew":
					endpoint = "/admin/marketplace/provider-enrollments/renew";
					body = {
						org_domain: enrollment.org_domain,
						capability_slug: enrollment.capability_slug,
						expires_at: values.expires_at || undefined,
						billing_reference: values.billing_reference || undefined,
						review_note: values.review_note || undefined,
					} as AdminRenewEnrollmentRequest;
					break;
				default:
					return;
			}

			const resp = await fetch(`${apiBaseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			if (resp.status === 200 || resp.status === 204) {
				message.success(t(`enrollments.success.${action}`));
				setModalState(null);
				actionForm.resetFields();
				fetchEnrollments(true);
			} else if (resp.status === 422) {
				message.error(t("enrollments.errors.invalidState"));
			} else {
				message.error(t(`enrollments.errors.${action}Failed`));
			}
		} catch {
			message.error(t("enrollments.errors.actionFailed"));
		} finally {
			setActionLoading(false);
		}
	}

	const columns = [
		{
			title: t("enrollments.table.orgDomain"),
			dataIndex: "org_domain",
			key: "org_domain",
		},
		{
			title: t("enrollments.table.capabilitySlug"),
			dataIndex: "capability_slug",
			key: "capability_slug",
		},
		{
			title: t("enrollments.table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={statusColor(status)}>{status}</Tag>
			),
		},
		{
			title: t("enrollments.table.billingStatus"),
			dataIndex: "billing_status",
			key: "billing_status",
			render: (v: string) => <Tag>{v}</Tag>,
		},
		{
			title: t("enrollments.table.expiresAt"),
			dataIndex: "expires_at",
			key: "expires_at",
			render: (v?: string) => (v ? formatDateTime(v) : "-"),
		},
		{
			title: t("enrollments.table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v),
		},
		...(canManage
			? [
					{
						title: t("enrollments.table.actions"),
						key: "actions",
						render: (_: unknown, record: AdminMarketplaceEnrollment) => {
							const actions: Array<{
								action: EnrollmentAction;
								label: string;
								danger?: boolean;
							}> = [];
							if (record.status === "pending_approval") {
								actions.push({ action: "approve", label: t("actions.approve") });
								actions.push({
									action: "reject",
									label: t("actions.reject"),
									danger: true,
								});
							}
							if (record.status === "active") {
								actions.push({
									action: "suspend",
									label: t("actions.suspend"),
									danger: true,
								});
								actions.push({ action: "renew", label: t("actions.renew") });
							}
							if (record.status === "suspended") {
								actions.push({
									action: "reinstate",
									label: t("actions.reinstate"),
								});
							}
							return (
								<Space>
									{actions.map(({ action, label, danger }) => (
										<Button
											key={action}
											size="small"
											danger={danger}
											onClick={() => {
												setModalState({ action, enrollment: record });
												actionForm.resetFields();
											}}
										>
											{label}
										</Button>
									))}
								</Space>
							);
						},
					},
				]
			: []),
	];

	const modalTitle =
		modalState ? t(`enrollments.modal.${modalState.action}.title`) : "";
	const needsNote =
		modalState &&
		["reject", "suspend"].includes(modalState.action);
	const hasOptionalFields =
		modalState &&
		["approve", "renew"].includes(modalState.action);

	return (
		<div>
			<div style={{ marginBottom: 16 }}>
				<Select
					style={{ width: 200 }}
					allowClear
					placeholder={t("enrollments.filterStatus")}
					value={filterStatus}
					onChange={(val) => {
						setFilterStatus(val);
						fetchEnrollments(true, val);
					}}
				>
					{["pending_approval", "active", "rejected", "suspended", "expired"].map(
						(s) => (
							<Select.Option key={s} value={s}>
								{s}
							</Select.Option>
						)
					)}
				</Select>
			</div>
			<Spin spinning={loading}>
				<Table
					dataSource={enrollments}
					columns={columns}
					rowKey={(r) => `${r.org_domain}:${r.capability_slug}`}
					pagination={false}
					size="small"
				/>
			</Spin>
			{hasMore && (
				<div style={{ marginTop: 16 }}>
					<Button onClick={() => fetchEnrollments(false)}>{t("loadMore")}</Button>
				</div>
			)}

			<Modal
				title={modalTitle}
				open={!!modalState}
				onCancel={() => {
					setModalState(null);
					actionForm.resetFields();
				}}
				footer={null}
			>
				<Spin spinning={actionLoading}>
					<Form form={actionForm} layout="vertical" onFinish={handleAction}>
						{modalState && (
							<>
								<Text type="secondary">
									{modalState.enrollment.org_domain} /{" "}
									{modalState.enrollment.capability_slug}
								</Text>
							</>
						)}
						{needsNote && (
							<Form.Item
								name="review_note"
								label={t("enrollments.modal.reviewNote")}
								rules={[{ required: true }]}
								style={{ marginTop: 12 }}
							>
								<TextArea rows={3} />
							</Form.Item>
						)}
						{hasOptionalFields && (
							<>
								<Form.Item
									name="expires_at"
									label={t("enrollments.modal.expiresAt")}
									style={{ marginTop: 12 }}
								>
									<Input placeholder="2027-12-31T00:00:00Z" />
								</Form.Item>
								<Form.Item
									name="billing_reference"
									label={t("enrollments.modal.billingReference")}
								>
									<Input />
								</Form.Item>
								<Form.Item
									name="review_note"
									label={t("enrollments.modal.reviewNote")}
								>
									<TextArea rows={2} />
								</Form.Item>
							</>
						)}
						<Form.Item style={{ marginTop: 12 }}>
							<Space>
								<Button type="primary" htmlType="submit">
									{t("submit")}
								</Button>
								<Button
									onClick={() => {
										setModalState(null);
										actionForm.resetFields();
									}}
								>
									{t("cancel")}
								</Button>
							</Space>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}

// ============================================================
// OFFERS TAB
// ============================================================

interface OffersTabProps {
	sessionToken: string | null;
	canManage: boolean;
}

type OfferAction = "approve" | "reject" | "suspend" | "reinstate";

interface OfferModalState {
	action: OfferAction;
	offer: AdminMarketplaceOffer;
}

function OffersTab({ sessionToken, canManage }: OffersTabProps) {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();

	const [offers, setOffers] = useState<AdminMarketplaceOffer[]>([]);
	const [loading, setLoading] = useState(true);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [hasMore, setHasMore] = useState(false);
	const [filterStatus, setFilterStatus] = useState<string | undefined>();

	const [modalState, setModalState] = useState<OfferModalState | null>(null);
	const [actionLoading, setActionLoading] = useState(false);
	const [actionForm] = Form.useForm();

	const fetchOffers = useCallback(
		async (reset = true, statusOverride?: string) => {
			setLoading(true);
			const status =
				statusOverride !== undefined ? statusOverride : filterStatus;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: {
					filter_status?: string;
					pagination_key?: string;
					limit: number;
				} = { limit: 50 };
				if (status) body.filter_status = status;
				if (!reset && nextKey) body.pagination_key = nextKey;
				const resp = await fetch(
					`${apiBaseUrl}/admin/marketplace/provider-offers/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(body),
					}
				);
				if (resp.status === 200) {
					const data: AdminListOffersResponse = await resp.json();
					if (reset) {
						setOffers(data.offers);
					} else {
						setOffers((prev) => [...prev, ...data.offers]);
					}
					setNextKey(data.next_pagination_key);
					setHasMore(!!data.next_pagination_key);
				} else {
					message.error(t("offers.errors.loadFailed"));
				}
			} catch {
				message.error(t("offers.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, nextKey, filterStatus, message, t]
	);

	useEffect(() => {
		fetchOffers(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionToken]);

	async function handleAction(values: Record<string, string>) {
		if (!modalState) return;
		setActionLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const { action, offer } = modalState;
			let endpoint = "";
			let body:
				| AdminApproveOfferRequest
				| AdminRejectOfferRequest
				| AdminSuspendOfferRequest
				| { org_domain: string; capability_slug: string };

			switch (action) {
				case "approve":
					endpoint = "/admin/marketplace/provider-offers/approve";
					body = {
						org_domain: offer.org_domain,
						capability_slug: offer.capability_slug,
						review_note: values.review_note || undefined,
					} as AdminApproveOfferRequest;
					break;
				case "reject":
					endpoint = "/admin/marketplace/provider-offers/reject";
					body = {
						org_domain: offer.org_domain,
						capability_slug: offer.capability_slug,
						review_note: values.review_note,
					} as AdminRejectOfferRequest;
					break;
				case "suspend":
					endpoint = "/admin/marketplace/provider-offers/suspend";
					body = {
						org_domain: offer.org_domain,
						capability_slug: offer.capability_slug,
						review_note: values.review_note,
					} as AdminSuspendOfferRequest;
					break;
				case "reinstate":
					endpoint = "/admin/marketplace/provider-offers/reinstate";
					body = {
						org_domain: offer.org_domain,
						capability_slug: offer.capability_slug,
					};
					break;
				default:
					return;
			}

			const resp = await fetch(`${apiBaseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			if (resp.status === 200 || resp.status === 204) {
				message.success(t(`offers.success.${action}`));
				setModalState(null);
				actionForm.resetFields();
				fetchOffers(true);
			} else if (resp.status === 422) {
				message.error(t("offers.errors.invalidState"));
			} else {
				message.error(t(`offers.errors.${action}Failed`));
			}
		} catch {
			message.error(t("offers.errors.actionFailed"));
		} finally {
			setActionLoading(false);
		}
	}

	const columns = [
		{
			title: t("offers.table.orgDomain"),
			dataIndex: "org_domain",
			key: "org_domain",
		},
		{
			title: t("offers.table.capabilitySlug"),
			dataIndex: "capability_slug",
			key: "capability_slug",
		},
		{
			title: t("offers.table.headline"),
			dataIndex: "headline",
			key: "headline",
		},
		{
			title: t("offers.table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={statusColor(status)}>{status}</Tag>
			),
		},
		{
			title: t("offers.table.contactMode"),
			dataIndex: "contact_mode",
			key: "contact_mode",
		},
		{
			title: t("offers.table.updatedAt"),
			dataIndex: "updated_at",
			key: "updated_at",
			render: (v: string) => formatDateTime(v),
		},
		...(canManage
			? [
					{
						title: t("offers.table.actions"),
						key: "actions",
						render: (_: unknown, record: AdminMarketplaceOffer) => {
							const actions: Array<{
								action: OfferAction;
								label: string;
								danger?: boolean;
							}> = [];
							if (record.status === "pending_review") {
								actions.push({ action: "approve", label: t("actions.approve") });
								actions.push({
									action: "reject",
									label: t("actions.reject"),
									danger: true,
								});
							}
							if (record.status === "active") {
								actions.push({
									action: "suspend",
									label: t("actions.suspend"),
									danger: true,
								});
							}
							if (record.status === "suspended") {
								actions.push({
									action: "reinstate",
									label: t("actions.reinstate"),
								});
							}
							return (
								<Space>
									{actions.map(({ action, label, danger }) => (
										<Button
											key={action}
											size="small"
											danger={danger}
											onClick={() => {
												setModalState({ action, offer: record });
												actionForm.resetFields();
											}}
										>
											{label}
										</Button>
									))}
								</Space>
							);
						},
					},
				]
			: []),
	];

	const needsNote =
		modalState && ["reject", "suspend"].includes(modalState.action);
	const noteOptional = modalState && modalState.action === "approve";

	return (
		<div>
			<div style={{ marginBottom: 16 }}>
				<Select
					style={{ width: 200 }}
					allowClear
					placeholder={t("offers.filterStatus")}
					value={filterStatus}
					onChange={(val) => {
						setFilterStatus(val);
						fetchOffers(true, val);
					}}
				>
					{["pending_review", "active", "rejected", "suspended"].map((s) => (
						<Select.Option key={s} value={s}>
							{s}
						</Select.Option>
					))}
				</Select>
			</div>
			<Spin spinning={loading}>
				<Table
					dataSource={offers}
					columns={columns}
					rowKey={(r) => `${r.org_domain}:${r.capability_slug}`}
					pagination={false}
					size="small"
				/>
			</Spin>
			{hasMore && (
				<div style={{ marginTop: 16 }}>
					<Button onClick={() => fetchOffers(false)}>{t("loadMore")}</Button>
				</div>
			)}

			<Modal
				title={
					modalState ? t(`offers.modal.${modalState.action}.title`) : ""
				}
				open={!!modalState}
				onCancel={() => {
					setModalState(null);
					actionForm.resetFields();
				}}
				footer={null}
			>
				<Spin spinning={actionLoading}>
					<Form form={actionForm} layout="vertical" onFinish={handleAction}>
						{modalState && (
							<Text type="secondary">
								{modalState.offer.org_domain} /{" "}
								{modalState.offer.capability_slug}
							</Text>
						)}
						{(needsNote || noteOptional) && (
							<Form.Item
								name="review_note"
								label={t("offers.modal.reviewNote")}
								rules={needsNote ? [{ required: true }] : []}
								style={{ marginTop: 12 }}
							>
								<TextArea rows={3} />
							</Form.Item>
						)}
						<Form.Item style={{ marginTop: 12 }}>
							<Space>
								<Button type="primary" htmlType="submit">
									{t("submit")}
								</Button>
								<Button
									onClick={() => {
										setModalState(null);
										actionForm.resetFields();
									}}
								>
									{t("cancel")}
								</Button>
							</Space>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}

// ============================================================
// SUBSCRIPTIONS TAB
// ============================================================

interface SubscriptionsTabProps {
	sessionToken: string | null;
	canManage: boolean;
}

type SubscriptionAction =
	| "approve"
	| "reject"
	| "markContractSigned"
	| "waiveContract"
	| "recordPayment"
	| "waivePayment"
	| "cancel";

interface SubscriptionModalState {
	action: SubscriptionAction;
	subscription: AdminMarketplaceSubscription;
}

function SubscriptionsTab({ sessionToken, canManage }: SubscriptionsTabProps) {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();

	const [subscriptions, setSubscriptions] = useState<
		AdminMarketplaceSubscription[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [hasMore, setHasMore] = useState(false);
	const [filterStatus, setFilterStatus] = useState<string | undefined>();

	const [modalState, setModalState] =
		useState<SubscriptionModalState | null>(null);
	const [actionLoading, setActionLoading] = useState(false);
	const [actionForm] = Form.useForm();

	const fetchSubscriptions = useCallback(
		async (reset = true, statusOverride?: string) => {
			setLoading(true);
			const status =
				statusOverride !== undefined ? statusOverride : filterStatus;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: {
					filter_status?: string;
					pagination_key?: string;
					limit: number;
				} = { limit: 50 };
				if (status) body.filter_status = status;
				if (!reset && nextKey) body.pagination_key = nextKey;
				const resp = await fetch(
					`${apiBaseUrl}/admin/marketplace/consumer-subscriptions/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(body),
					}
				);
				if (resp.status === 200) {
					const data: AdminListSubscriptionsResponse = await resp.json();
					if (reset) {
						setSubscriptions(data.subscriptions);
					} else {
						setSubscriptions((prev) => [...prev, ...data.subscriptions]);
					}
					setNextKey(data.next_pagination_key);
					setHasMore(!!data.next_pagination_key);
				} else {
					message.error(t("subscriptions.errors.loadFailed"));
				}
			} catch {
				message.error(t("subscriptions.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, nextKey, filterStatus, message, t]
	);

	useEffect(() => {
		fetchSubscriptions(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionToken]);

	async function handleAction(values: Record<string, string>) {
		if (!modalState) return;
		setActionLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const { action, subscription } = modalState;
			const base = {
				consumer_org_domain: subscription.consumer_org_domain,
				provider_org_domain: subscription.provider_org_domain,
				capability_slug: subscription.capability_slug,
			};
			let endpoint = "";
			let body:
				| AdminApproveSubscriptionRequest
				| AdminRejectSubscriptionRequest
				| AdminMarkContractSignedRequest
				| AdminWaiveContractRequest
				| AdminRecordPaymentRequest
				| AdminWaivePaymentRequest
				| typeof base;

			switch (action) {
				case "approve":
					endpoint = "/admin/marketplace/consumer-subscriptions/approve";
					body = {
						...base,
						review_note: values.note || undefined,
					} as AdminApproveSubscriptionRequest;
					break;
				case "reject":
					endpoint = "/admin/marketplace/consumer-subscriptions/reject";
					body = {
						...base,
						review_note: values.note,
					} as AdminRejectSubscriptionRequest;
					break;
				case "markContractSigned":
					endpoint =
						"/admin/marketplace/consumer-subscriptions/mark-contract-signed";
					body = { ...base, note: values.note || undefined } as AdminMarkContractSignedRequest;
					break;
				case "waiveContract":
					endpoint = "/admin/marketplace/consumer-subscriptions/waive-contract";
					body = { ...base, note: values.note } as AdminWaiveContractRequest;
					break;
				case "recordPayment":
					endpoint = "/admin/marketplace/consumer-subscriptions/record-payment";
					body = { ...base, note: values.note || undefined } as AdminRecordPaymentRequest;
					break;
				case "waivePayment":
					endpoint = "/admin/marketplace/consumer-subscriptions/waive-payment";
					body = { ...base, note: values.note } as AdminWaivePaymentRequest;
					break;
				case "cancel":
					endpoint = "/admin/marketplace/consumer-subscriptions/cancel";
					body = base;
					break;
				default:
					return;
			}

			const resp = await fetch(`${apiBaseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			if (resp.status === 200 || resp.status === 204) {
				message.success(t(`subscriptions.success.${action}`));
				setModalState(null);
				actionForm.resetFields();
				fetchSubscriptions(true);
			} else if (resp.status === 422) {
				message.error(t("subscriptions.errors.invalidState"));
			} else {
				message.error(t(`subscriptions.errors.${action}Failed`));
			}
		} catch {
			message.error(t("subscriptions.errors.actionFailed"));
		} finally {
			setActionLoading(false);
		}
	}

	const columns = [
		{
			title: t("subscriptions.table.consumerOrgDomain"),
			dataIndex: "consumer_org_domain",
			key: "consumer_org_domain",
		},
		{
			title: t("subscriptions.table.providerOrgDomain"),
			dataIndex: "provider_org_domain",
			key: "provider_org_domain",
		},
		{
			title: t("subscriptions.table.capabilitySlug"),
			dataIndex: "capability_slug",
			key: "capability_slug",
		},
		{
			title: t("subscriptions.table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={statusColor(status)}>{status}</Tag>
			),
		},
		{
			title: t("subscriptions.table.requiresAdminReview"),
			dataIndex: "requires_admin_review",
			key: "requires_admin_review",
			render: (v: boolean) => (v ? t("yes") : t("no")),
		},
		{
			title: t("subscriptions.table.requiresContract"),
			dataIndex: "requires_contract",
			key: "requires_contract",
			render: (v: boolean) => (v ? t("yes") : t("no")),
		},
		{
			title: t("subscriptions.table.requiresPayment"),
			dataIndex: "requires_payment",
			key: "requires_payment",
			render: (v: boolean) => (v ? t("yes") : t("no")),
		},
		{
			title: t("subscriptions.table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v),
		},
		...(canManage
			? [
					{
						title: t("subscriptions.table.actions"),
						key: "actions",
						render: (_: unknown, record: AdminMarketplaceSubscription) => {
							const actions: Array<{
								action: SubscriptionAction;
								label: string;
								danger?: boolean;
							}> = [];
							if (record.status === "pending_admin_approval") {
								actions.push({ action: "approve", label: t("actions.approve") });
								actions.push({
									action: "reject",
									label: t("actions.reject"),
									danger: true,
								});
							}
							if (record.status === "active" || record.status === "pending_contract") {
								actions.push({
									action: "markContractSigned",
									label: t("actions.markContractSigned"),
								});
								actions.push({
									action: "waiveContract",
									label: t("actions.waiveContract"),
								});
							}
							if (record.status === "active" || record.status === "pending_payment") {
								actions.push({
									action: "recordPayment",
									label: t("actions.recordPayment"),
								});
								actions.push({
									action: "waivePayment",
									label: t("actions.waivePayment"),
								});
							}
							if (record.status !== "cancelled") {
								actions.push({
									action: "cancel",
									label: t("actions.cancel"),
									danger: true,
								});
							}
							return (
								<Space wrap>
									{actions.map(({ action, label, danger }) => (
										<Button
											key={action}
											size="small"
											danger={danger}
											onClick={() => {
												setModalState({ action, subscription: record });
												actionForm.resetFields();
											}}
										>
											{label}
										</Button>
									))}
								</Space>
							);
						},
					},
				]
			: []),
	];

	const requiresNote =
		modalState && ["reject", "waiveContract", "waivePayment"].includes(modalState.action);
	const hasOptionalNote =
		modalState &&
		["approve", "markContractSigned", "recordPayment"].includes(
			modalState.action
		);

	return (
		<div>
			<div style={{ marginBottom: 16 }}>
				<Select
					style={{ width: 220 }}
					allowClear
					placeholder={t("subscriptions.filterStatus")}
					value={filterStatus}
					onChange={(val) => {
						setFilterStatus(val);
						fetchSubscriptions(true, val);
					}}
				>
					{[
						"pending_provider_approval",
						"pending_admin_approval",
						"pending_contract",
						"pending_payment",
						"active",
						"rejected",
						"cancelled",
					].map((s) => (
						<Select.Option key={s} value={s}>
							{s}
						</Select.Option>
					))}
				</Select>
			</div>
			<Spin spinning={loading}>
				<Table
					dataSource={subscriptions}
					columns={columns}
					rowKey={(r) =>
						`${r.consumer_org_domain}:${r.provider_org_domain}:${r.capability_slug}`
					}
					pagination={false}
					size="small"
				/>
			</Spin>
			{hasMore && (
				<div style={{ marginTop: 16 }}>
					<Button onClick={() => fetchSubscriptions(false)}>
						{t("loadMore")}
					</Button>
				</div>
			)}

			<Modal
				title={
					modalState
						? t(`subscriptions.modal.${modalState.action}.title`)
						: ""
				}
				open={!!modalState}
				onCancel={() => {
					setModalState(null);
					actionForm.resetFields();
				}}
				footer={null}
			>
				<Spin spinning={actionLoading}>
					<Form form={actionForm} layout="vertical" onFinish={handleAction}>
						{modalState && (
							<Text type="secondary">
								{modalState.subscription.consumer_org_domain} →{" "}
								{modalState.subscription.provider_org_domain} /{" "}
								{modalState.subscription.capability_slug}
							</Text>
						)}
						{(requiresNote || hasOptionalNote) &&
							modalState?.action !== "cancel" && (
								<Form.Item
									name="note"
									label={t("subscriptions.modal.note")}
									rules={requiresNote ? [{ required: true }] : []}
									style={{ marginTop: 12 }}
								>
									<TextArea rows={3} />
								</Form.Item>
							)}
						<Form.Item style={{ marginTop: 12 }}>
							<Space>
								<Button type="primary" htmlType="submit">
									{t("submit")}
								</Button>
								<Button
									onClick={() => {
										setModalState(null);
										actionForm.resetFields();
									}}
								>
									{t("cancel")}
								</Button>
							</Space>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}

// ============================================================
// BILLING TAB
// ============================================================

interface BillingTabProps {
	sessionToken: string | null;
}

function BillingTab({ sessionToken }: BillingTabProps) {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();

	const [records, setRecords] = useState<AdminBillingRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [hasMore, setHasMore] = useState(false);

	const fetchBilling = useCallback(
		async (reset = true) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: { pagination_key?: string; limit: number } = { limit: 50 };
				if (!reset && nextKey) body.pagination_key = nextKey;
				const resp = await fetch(
					`${apiBaseUrl}/admin/marketplace/billing/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(body),
					}
				);
				if (resp.status === 200) {
					const data: AdminListBillingResponse = await resp.json();
					if (reset) {
						setRecords(data.records);
					} else {
						setRecords((prev) => [...prev, ...data.records]);
					}
					setNextKey(data.next_pagination_key);
					setHasMore(!!data.next_pagination_key);
				} else {
					message.error(t("billing.errors.loadFailed"));
				}
			} catch {
				message.error(t("billing.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, nextKey, message, t]
	);

	useEffect(() => {
		fetchBilling(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionToken]);

	const columns = [
		{
			title: t("billing.table.consumerOrgDomain"),
			dataIndex: "consumer_org_domain",
			key: "consumer_org_domain",
		},
		{
			title: t("billing.table.providerOrgDomain"),
			dataIndex: "provider_org_domain",
			key: "provider_org_domain",
		},
		{
			title: t("billing.table.capabilitySlug"),
			dataIndex: "capability_slug",
			key: "capability_slug",
		},
		{
			title: t("billing.table.eventType"),
			dataIndex: "event_type",
			key: "event_type",
			render: (v: string) => <Tag>{v}</Tag>,
		},
		{
			title: t("billing.table.note"),
			dataIndex: "note",
			key: "note",
			render: (v?: string) => v ?? "-",
		},
		{
			title: t("billing.table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v),
		},
	];

	return (
		<div>
			<Spin spinning={loading}>
				<Table
					dataSource={records}
					columns={columns}
					rowKey={(r, i) =>
						`${r.consumer_org_domain}:${r.provider_org_domain}:${r.capability_slug}:${i}`
					}
					pagination={false}
					size="small"
				/>
			</Spin>
			{hasMore && (
				<div style={{ marginTop: 16 }}>
					<Button onClick={() => fetchBilling(false)}>{t("loadMore")}</Button>
				</div>
			)}
		</div>
	);
}

// ============================================================
// MAIN PAGE
// ============================================================

export function AdminMarketplacePage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const canManage =
		myInfo?.roles.includes("admin:manage_marketplace") ||
		myInfo?.roles.includes("admin:superadmin") ||
		false;

	const tabItems = [
		{
			key: "capabilities",
			label: t("tabs.capabilities"),
			icon: <SyncOutlined />,
			children: (
				<CapabilitiesTab sessionToken={sessionToken} canManage={canManage} />
			),
		},
		{
			key: "enrollments",
			label: t("tabs.enrollments"),
			icon: <CheckOutlined />,
			children: (
				<EnrollmentsTab sessionToken={sessionToken} canManage={canManage} />
			),
		},
		{
			key: "offers",
			label: t("tabs.offers"),
			icon: <PlusOutlined />,
			children: (
				<OffersTab sessionToken={sessionToken} canManage={canManage} />
			),
		},
		{
			key: "subscriptions",
			label: t("tabs.subscriptions"),
			icon: <CloseOutlined />,
			children: (
				<SubscriptionsTab sessionToken={sessionToken} canManage={canManage} />
			),
		},
		{
			key: "billing",
			label: t("tabs.billing"),
			children: <BillingTab sessionToken={sessionToken} />,
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
				{t("title")}
			</Title>
			<Tabs items={tabItems} />
		</div>
	);
}
