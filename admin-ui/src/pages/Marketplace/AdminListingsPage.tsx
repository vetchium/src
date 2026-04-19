import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Form,
	Input,
	Modal,
	Select,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	MarketplaceListing,
	MarketplaceListingStatus,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;
const { TextArea } = Input;

const STATUS_COLORS: Record<MarketplaceListingStatus, string> = {
	draft: "default",
	pending_review: "processing",
	active: "success",
	suspended: "warning",
	archived: "error",
};

const FILTER_STATUSES: MarketplaceListingStatus[] = [
	"draft",
	"pending_review",
	"active",
	"suspended",
	"archived",
];

export function AdminListingsPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();
	const [suspendForm] = Form.useForm();

	const canManage =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:manage_marketplace") ||
		false;

	const [listings, setListings] = useState<MarketplaceListing[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [filterStatus, setFilterStatus] = useState<
		MarketplaceListingStatus | undefined
	>("active");
	const [suspendModalOpen, setSuspendModalOpen] = useState(false);
	const [selectedListing, setSelectedListing] =
		useState<MarketplaceListing | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const loadListings = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(`${baseUrl}/admin/marketplace/listing/list`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						...(filterStatus ? { filter_status: filterStatus } : {}),
						...(paginationKey ? { pagination_key: paginationKey } : {}),
						limit: 20,
					}),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					if (paginationKey) {
						setListings((prev) => [...prev, ...(data.listings || [])]);
					} else {
						setListings(data.listings || []);
					}
					setNextKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, filterStatus]
	);

	useEffect(() => {
		loadListings();
	}, [loadListings]);

	const handleSuspend = async (values: { suspension_note: string }) => {
		if (!sessionToken || !selectedListing) return;
		setSubmitting(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/admin/marketplace/listing/suspend`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						org_domain: selectedListing.org_domain,
						listing_number: selectedListing.listing_number,
						suspension_note: values.suspension_note,
					}),
				}
			);
			if (resp.status === 200) {
				message.success(t("adminListings.suspendSuccess"));
				setSuspendModalOpen(false);
				suspendForm.resetFields();
				setSelectedListing(null);
				loadListings();
			} else if (resp.status === 400) {
				const errs = await resp.json();
				message.error(
					errs.map((e: { message: string }) => e.message).join(", ")
				);
			} else {
				message.error(t("adminListings.suspendError"));
			}
		} finally {
			setSubmitting(false);
		}
	};

	const handleReinstate = async (listing: MarketplaceListing) => {
		if (!sessionToken) return;
		setSubmitting(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/admin/marketplace/listing/reinstate`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						org_domain: listing.org_domain,
						listing_number: listing.listing_number,
					}),
				}
			);
			if (resp.status === 200) {
				message.success(t("adminListings.reinstateSuccess"));
				loadListings();
			} else {
				message.error(t("adminListings.reinstateError"));
			}
		} finally {
			setSubmitting(false);
		}
	};

	const columns = [
		{
			title: t("listings.headline"),
			dataIndex: "headline",
			key: "headline",
		},
		{
			title: t("adminListings.orgDomain"),
			dataIndex: "org_domain",
			key: "org_domain",
		},
		{
			title: t("listings.number"),
			dataIndex: "listing_number",
			key: "listing_number",
			render: (num: number) => `#${num}`,
		},
		{
			title: t("listings.status"),
			dataIndex: "status",
			key: "status",
			render: (status: MarketplaceListingStatus) => (
				<Tag color={STATUS_COLORS[status]}>{t(`status.${status}`)}</Tag>
			),
		},
		{
			title: t("adminListings.subscribers"),
			dataIndex: "active_subscriber_count",
			key: "active_subscriber_count",
		},
		...(canManage
			? [
					{
						title: t("listings.actions"),
						key: "actions",
						render: (_: unknown, record: MarketplaceListing) => {
							if (record.status === "active") {
								return (
									<Button
										size="small"
										danger
										loading={submitting}
										onClick={() => {
											setSelectedListing(record);
											setSuspendModalOpen(true);
										}}
									>
										{t("adminListings.suspend")}
									</Button>
								);
							}
							if (record.status === "suspended") {
								return (
									<Button
										size="small"
										loading={submitting}
										onClick={() => handleReinstate(record)}
									>
										{t("adminListings.reinstate")}
									</Button>
								);
							}
							return null;
						},
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
				{t("adminListings.title")}
			</Title>

			<div style={{ marginBottom: 16 }}>
				<Select
					value={filterStatus}
					allowClear
					placeholder={t("listings.filterByStatus")}
					style={{ width: 200 }}
					onChange={(val) =>
						setFilterStatus(val as MarketplaceListingStatus | undefined)
					}
					options={FILTER_STATUSES.map((s) => ({
						value: s,
						label: t(`status.${s}`),
					}))}
				/>
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={listings}
					columns={columns}
					rowKey="listing_id"
					pagination={false}
					footer={() =>
						nextKey ? (
							<div style={{ textAlign: "center" }}>
								<Button onClick={() => loadListings(nextKey)}>
									{t("loadMore")}
								</Button>
							</div>
						) : null
					}
				/>
			</Spin>

			{/* Suspend modal */}
			<Modal
				open={suspendModalOpen}
				title={t("adminListings.suspendTitle")}
				onOk={() => suspendForm.submit()}
				onCancel={() => {
					setSuspendModalOpen(false);
					suspendForm.resetFields();
					setSelectedListing(null);
				}}
				confirmLoading={submitting}
				okText={t("adminListings.suspendSubmit")}
				okButtonProps={{ danger: true }}
			>
				<Form form={suspendForm} layout="vertical" onFinish={handleSuspend}>
					<Form.Item
						name="suspension_note"
						label={t("adminListings.suspensionNote")}
						rules={[
							{
								required: true,
								message: t("adminListings.suspensionNoteRequired"),
							},
							{
								max: 2000,
								message: t("adminListings.suspensionNoteMax"),
							},
						]}
					>
						<TextArea rows={4} maxLength={2000} showCount />
					</Form.Item>
				</Form>
			</Modal>
		</div>
	);
}
