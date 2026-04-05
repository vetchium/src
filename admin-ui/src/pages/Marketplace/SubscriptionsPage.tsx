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
	AdminMarketplaceSubscription,
	AdminListSubscriptionsResponse,
	AdminApproveSubscriptionRequest,
	AdminRejectSubscriptionRequest,
	AdminMarkContractSignedRequest,
	AdminWaiveContractRequest,
	AdminRecordPaymentRequest,
	AdminWaivePaymentRequest,
} from "vetchium-specs/admin/marketplace";
import { MarketplaceSubscriptionStatus } from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { statusColor } from "./marketplaceUtils";

const { Title, Text } = Typography;
const { TextArea } = Input;

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

export function SubscriptionsPage() {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const canManage =
		myInfo?.roles.includes("admin:manage_marketplace") ||
		myInfo?.roles.includes("admin:superadmin") ||
		false;

	const [subscriptions, setSubscriptions] = useState<
		AdminMarketplaceSubscription[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [hasMore, setHasMore] = useState(false);
	const [filterStatus, setFilterStatus] = useState<string | undefined>();

	const [modalState, setModalState] = useState<SubscriptionModalState | null>(
		null
	);
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
					body = {
						...base,
						note: values.note || undefined,
					} as AdminMarkContractSignedRequest;
					break;
				case "waiveContract":
					endpoint = "/admin/marketplace/consumer-subscriptions/waive-contract";
					body = { ...base, note: values.note } as AdminWaiveContractRequest;
					break;
				case "recordPayment":
					endpoint = "/admin/marketplace/consumer-subscriptions/record-payment";
					body = {
						...base,
						note: values.note || undefined,
					} as AdminRecordPaymentRequest;
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
							if (record.status === MarketplaceSubscriptionStatus.AdminReview) {
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
							if (
								record.status === MarketplaceSubscriptionStatus.Active ||
								record.status === MarketplaceSubscriptionStatus.AwaitingContract
							) {
								actions.push({
									action: "markContractSigned",
									label: t("actions.markContractSigned"),
								});
								actions.push({
									action: "waiveContract",
									label: t("actions.waiveContract"),
								});
							}
							if (
								record.status === MarketplaceSubscriptionStatus.Active ||
								record.status === MarketplaceSubscriptionStatus.AwaitingPayment
							) {
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
		modalState &&
		["reject", "waiveContract", "waivePayment"].includes(modalState.action);
	const hasOptionalNote =
		modalState &&
		["approve", "markContractSigned", "recordPayment"].includes(
			modalState.action
		);

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
				{t("tabs.subscriptions")}
			</Title>

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
					{(
						[
							MarketplaceSubscriptionStatus.Requested,
							MarketplaceSubscriptionStatus.ProviderReview,
							MarketplaceSubscriptionStatus.AdminReview,
							MarketplaceSubscriptionStatus.AwaitingContract,
							MarketplaceSubscriptionStatus.AwaitingPayment,
							MarketplaceSubscriptionStatus.Active,
							MarketplaceSubscriptionStatus.Rejected,
							MarketplaceSubscriptionStatus.Cancelled,
						] as MarketplaceSubscriptionStatus[]
					).map((s) => (
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
					modalState ? t(`subscriptions.modal.${modalState.action}.title`) : ""
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
