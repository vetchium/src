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
	AdminMarketplaceListing,
	AdminListListingsResponse,
	AdminSuspendListingRequest,
	AdminReinstateListingRequest,
} from "vetchium-specs/admin/marketplace";
import { MarketplaceListingStatus } from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { statusColor } from "./marketplaceUtils";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface ListingModalState {
	action: "suspend" | "reinstate";
	listing: AdminMarketplaceListing;
}

export function ListingsPage() {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const canManage =
		myInfo?.roles.includes("admin:manage_marketplace") ||
		myInfo?.roles.includes("admin:superadmin") ||
		false;

	const [listings, setListings] = useState<AdminMarketplaceListing[]>([]);
	const [loading, setLoading] = useState(true);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [hasMore, setHasMore] = useState(false);
	const [filterStatus, setFilterStatus] = useState<string | undefined>();

	const [modalState, setModalState] = useState<ListingModalState | null>(null);
	const [actionLoading, setActionLoading] = useState(false);
	const [actionForm] = Form.useForm();

	const fetchListings = useCallback(
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
					`${apiBaseUrl}/admin/marketplace/listings/list`,
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
					const data: AdminListListingsResponse = await resp.json();
					if (reset) {
						setListings(data.listings);
					} else {
						setListings((prev) => [...prev, ...data.listings]);
					}
					setNextKey(data.next_pagination_key);
					setHasMore(!!data.next_pagination_key);
				} else {
					message.error(t("listings.errors.loadFailed"));
				}
			} catch {
				message.error(t("listings.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, nextKey, filterStatus, message, t]
	);

	useEffect(() => {
		fetchListings(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionToken]);

	async function handleAction(values: { note?: string }) {
		if (!modalState) return;
		setActionLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const { action, listing } = modalState;
			let endpoint = "";
			let body: AdminSuspendListingRequest | AdminReinstateListingRequest;

			if (action === "suspend") {
				endpoint = "/admin/marketplace/listings/suspend";
				body = {
					listing_id: listing.listing_id,
					suspension_note: values.note || "",
				};
			} else {
				endpoint = "/admin/marketplace/listings/reinstate";
				body = { listing_id: listing.listing_id };
			}

			const resp = await fetch(`${apiBaseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			if (resp.status === 200) {
				message.success(t(`listings.success.${action}`));
				setModalState(null);
				actionForm.resetFields();
				fetchListings(true);
			} else {
				message.error(t(`listings.errors.${action}Failed`));
			}
		} catch {
			message.error(t("listings.errors.actionFailed"));
		} finally {
			setActionLoading(false);
		}
	}

	const columns = [
		{
			title: t("listings.table.orgDomain"),
			dataIndex: "org_domain",
			key: "org_domain",
		},
		{
			title: t("listings.table.capabilityId"),
			dataIndex: "capability_id",
			key: "capability_id",
		},
		{
			title: t("listings.table.headline"),
			dataIndex: "headline",
			key: "headline",
		},
		{
			title: t("listings.table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={statusColor(status)}>{status}</Tag>
			),
		},
		{
			title: t("listings.table.updatedAt"),
			dataIndex: "updated_at",
			key: "updated_at",
			render: (v: string) => formatDateTime(v),
		},
		...(canManage
			? [
					{
						title: t("listings.table.actions"),
						key: "actions",
						render: (_: unknown, record: AdminMarketplaceListing) => (
							<Space>
								{record.status === MarketplaceListingStatus.Active && (
									<Button
										size="small"
										danger
										onClick={() =>
											setModalState({ action: "suspend", listing: record })
										}
									>
										{t("actions.suspend")}
									</Button>
								)}
								{record.status === MarketplaceListingStatus.Suspended && (
									<Button
										size="small"
										onClick={() =>
											setModalState({ action: "reinstate", listing: record })
										}
									>
										{t("actions.reinstate")}
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
				{t("tabs.listings")}
			</Title>

			<div style={{ marginBottom: 16 }}>
				<Select
					style={{ width: 200 }}
					allowClear
					placeholder={t("listings.filterStatus")}
					value={filterStatus}
					onChange={(val) => {
						setFilterStatus(val);
						fetchListings(true, val);
					}}
				>
					{[
						MarketplaceListingStatus.Draft,
						MarketplaceListingStatus.Active,
						MarketplaceListingStatus.Suspended,
						MarketplaceListingStatus.Archived,
					].map((s) => (
						<Select.Option key={s} value={s}>
							{s}
						</Select.Option>
					))}
				</Select>
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={listings}
					columns={columns}
					rowKey="listing_id"
					pagination={false}
					size="small"
				/>
			</Spin>

			{hasMore && (
				<div style={{ marginTop: 16 }}>
					<Button onClick={() => fetchListings(false)}>{t("loadMore")}</Button>
				</div>
			)}

			<Modal
				title={modalState ? t(`listings.modal.${modalState.action}.title`) : ""}
				open={!!modalState}
				onCancel={() => {
					setModalState(null);
					actionForm.resetFields();
				}}
				footer={null}
			>
				<Spin spinning={actionLoading}>
					<Form form={actionForm} layout="vertical" onFinish={handleAction}>
						{modalState?.action === "suspend" && (
							<Form.Item
								name="note"
								label={t("listings.modal.suspensionNote")}
								rules={[{ required: true }]}
							>
								<TextArea rows={4} />
							</Form.Item>
						)}
						{modalState?.action === "reinstate" && (
							<div style={{ marginBottom: 16 }}>
								<Text>{t("listings.modal.reinstate.confirm")}</Text>
							</div>
						)}
						<Form.Item>
							<Space>
								<Button type="primary" htmlType="submit">
									{t("submit")}
								</Button>
								<Button onClick={() => setModalState(null)}>
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
