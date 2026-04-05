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
	AdminMarketplaceOffer,
	AdminListOffersResponse,
	AdminApproveOfferRequest,
	AdminRejectOfferRequest,
	AdminSuspendOfferRequest,
} from "vetchium-specs/admin/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { statusColor } from "./marketplaceUtils";

const { Title, Text } = Typography;
const { TextArea } = Input;

type OfferAction = "approve" | "reject" | "suspend" | "reinstate";

interface OfferModalState {
	action: OfferAction;
	offer: AdminMarketplaceOffer;
}

export function OffersPage() {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const canManage =
		myInfo?.roles.includes("admin:manage_marketplace") ||
		myInfo?.roles.includes("admin:superadmin") ||
		false;

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
				{t("tabs.offers")}
			</Title>

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
				title={modalState ? t(`offers.modal.${modalState.action}.title`) : ""}
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
