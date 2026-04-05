import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Form,
	Input,
	Modal,
	Select,
	Space,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AdminMarketplaceEnrollment,
	AdminListEnrollmentsResponse,
	AdminApproveEnrollmentRequest,
	AdminRejectEnrollmentRequest,
	AdminSuspendEnrollmentRequest,
	AdminRenewEnrollmentRequest,
} from "vetchium-specs/admin/marketplace";
import { MarketplaceEnrollmentStatus } from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { statusColor } from "./marketplaceUtils";

const { Title, Text } = Typography;
const { TextArea } = Input;

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

export function EnrollmentsPage() {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const canManage =
		myInfo?.roles.includes("admin:manage_marketplace") ||
		myInfo?.roles.includes("admin:superadmin") ||
		false;

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
							if (record.status === MarketplaceEnrollmentStatus.PendingReview) {
								actions.push({
									action: "approve",
									label: t("actions.approve"),
								});
								actions.push({
									action: "reject",
									label: t("actions.reject"),
									danger: true,
								});
							}
							if (record.status === MarketplaceEnrollmentStatus.Approved) {
								actions.push({
									action: "suspend",
									label: t("actions.suspend"),
									danger: true,
								});
								actions.push({ action: "renew", label: t("actions.renew") });
							}
							if (record.status === MarketplaceEnrollmentStatus.Suspended) {
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

	const modalTitle = modalState
		? t(`enrollments.modal.${modalState.action}.title`)
		: "";
	const needsNote =
		modalState && ["reject", "suspend"].includes(modalState.action);
	const hasOptionalFields =
		modalState && ["approve", "renew"].includes(modalState.action);

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
				{t("tabs.enrollments")}
			</Title>

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
					{(
						[
							MarketplaceEnrollmentStatus.PendingReview,
							MarketplaceEnrollmentStatus.Approved,
							MarketplaceEnrollmentStatus.Rejected,
							MarketplaceEnrollmentStatus.Suspended,
							MarketplaceEnrollmentStatus.Expired,
						] as MarketplaceEnrollmentStatus[]
					).map((s) => (
						<Select.Option key={s} value={s}>
							{s}
						</Select.Option>
					))}
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
					<Button onClick={() => fetchEnrollments(false)}>
						{t("loadMore")}
					</Button>
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
							<Text type="secondary">
								{modalState.enrollment.org_domain} /{" "}
								{modalState.enrollment.capability_slug}
							</Text>
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
