import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Form,
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
	AdminCancelSubscriptionRequest,
} from "vetchium-specs/admin/marketplace";
import { MarketplaceSubscriptionStatus } from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { statusColor } from "./marketplaceUtils";

const { Title, Text } = Typography;

interface SubscriptionModalState {
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
					`${apiBaseUrl}/admin/marketplace/subscriptions/list`,
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

	async function handleCancel() {
		if (!modalState) return;
		setActionLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const { subscription } = modalState;
			const body: AdminCancelSubscriptionRequest = {
				subscription_id: subscription.subscription_id,
			};

			const resp = await fetch(
				`${apiBaseUrl}/admin/marketplace/subscriptions/cancel`,
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
				message.success(t("subscriptions.success.cancel"));
				setModalState(null);
				fetchSubscriptions(true);
			} else {
				message.error(t("subscriptions.errors.cancelFailed"));
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
			title: t("subscriptions.table.capabilityId"),
			dataIndex: "capability_id",
			key: "capability_id",
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
						render: (_: unknown, record: AdminMarketplaceSubscription) => (
							<Space wrap>
								{record.status === MarketplaceSubscriptionStatus.Active && (
									<Button
										size="small"
										danger
										onClick={() => setModalState({ subscription: record })}
									>
										{t("actions.cancel")}
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
					{[
						MarketplaceSubscriptionStatus.Active,
						MarketplaceSubscriptionStatus.Cancelled,
						MarketplaceSubscriptionStatus.Expired,
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
					rowKey="subscription_id"
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
				title={t("subscriptions.modal.cancel.title")}
				open={!!modalState}
				onCancel={() => setModalState(null)}
				footer={[
					<Button key="back" onClick={() => setModalState(null)}>
						{t("cancel")}
					</Button>,
					<Button
						key="submit"
						type="primary"
						danger
						loading={actionLoading}
						onClick={handleCancel}
					>
						{t("submit")}
					</Button>,
				]}
			>
				{modalState && (
					<Text>
						Are you sure you want to cancel the subscription for{" "}
						<Text strong>{modalState.subscription.consumer_org_domain}</Text> to{" "}
						<Text strong>{modalState.subscription.provider_org_domain}</Text>'s{" "}
						<Text strong>{modalState.subscription.capability_id}</Text> service?
					</Text>
				)}
			</Modal>
		</div>
	);
}
