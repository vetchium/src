import {
	Alert,
	App,
	Button,
	Form,
	Input,
	Modal,
	Space,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	ServiceListing,
	ServiceListingState,
	SubmitMarketplaceServiceListingAppealRequest,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text } = Typography;
const { TextArea } = Input;

function stateColor(state: ServiceListingState): string {
	switch (state) {
		case "active":
			return "green";
		case "draft":
			return "default";
		case "pending_review":
			return "blue";
		case "paused":
			return "orange";
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

function canEdit(state: ServiceListingState): boolean {
	return ["draft", "active", "paused", "rejected"].includes(state);
}

interface Props {
	hasCapability: boolean;
}

export function MarketplaceListingsPage({ hasCapability }: Props) {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();

	const [listings, setListings] = useState<ServiceListing[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);

	const [appealModalOpen, setAppealModalOpen] = useState(false);
	const [appealLoading, setAppealLoading] = useState(false);
	const [appealListingId, setAppealListingId] = useState<string>("");
	const [appealReason, setAppealReason] = useState("");

	const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

	const loadListings = useCallback(
		async (cursor?: string, reset?: boolean) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(
					`${baseUrl}/org/list-marketplace-service-listings`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify({ ...(cursor ? { cursor } : {}) }),
					}
				);
				if (resp.status === 200) {
					const data = await resp.json();
					const items: ServiceListing[] = data.service_listings ?? [];
					if (reset) {
						setListings(items);
					} else {
						setListings((prev) => [...prev, ...items]);
					}
					setNextCursor(data.next_cursor ?? undefined);
				} else {
					message.error(t("listings.errors.loadFailed"));
				}
			} catch {
				message.error(t("listings.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	useEffect(() => {
		loadListings(undefined, true);
	}, [loadListings]);

	const handleSubmit = async (id: string) => {
		if (!sessionToken) return;
		setActionLoadingId(id);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/submit-marketplace-service-listing`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ name: id }),
				}
			);
			if (resp.status === 200) {
				message.success(t("listings.success.submitted"));
				loadListings(undefined, true);
			} else {
				message.error(t("listings.errors.submitFailed"));
			}
		} catch {
			message.error(t("listings.errors.submitFailed"));
		} finally {
			setActionLoadingId(null);
		}
	};

	const handlePause = async (id: string) => {
		if (!sessionToken) return;
		setActionLoadingId(id);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/pause-marketplace-service-listing`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ name: id }),
				}
			);
			if (resp.status === 200) {
				message.success(t("listings.success.paused"));
				loadListings(undefined, true);
			} else {
				message.error(t("listings.errors.pauseFailed"));
			}
		} catch {
			message.error(t("listings.errors.pauseFailed"));
		} finally {
			setActionLoadingId(null);
		}
	};

	const handleUnpause = async (id: string) => {
		if (!sessionToken) return;
		setActionLoadingId(id);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/unpause-marketplace-service-listing`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ name: id }),
				}
			);
			if (resp.status === 200) {
				message.success(t("listings.success.unpaused"));
				loadListings(undefined, true);
			} else {
				message.error(t("listings.errors.unpauseFailed"));
			}
		} catch {
			message.error(t("listings.errors.unpauseFailed"));
		} finally {
			setActionLoadingId(null);
		}
	};

	const handleArchive = async (id: string) => {
		if (!sessionToken) return;
		setActionLoadingId(id);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/archive-marketplace-service-listing`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ name: id }),
				}
			);
			if (resp.status === 200) {
				message.success(t("listings.success.archived"));
				loadListings(undefined, true);
			} else {
				message.error(t("listings.errors.archiveFailed"));
			}
		} catch {
			message.error(t("listings.errors.archiveFailed"));
		} finally {
			setActionLoadingId(null);
		}
	};

	const handleAppeal = async () => {
		if (!sessionToken || !appealListingId) return;
		if (!appealReason.trim()) {
			message.error(t("listings.errors.appealReasonRequired"));
			return;
		}
		if (appealReason.length > 2000) {
			message.error(t("listings.errors.appealReasonTooLong"));
			return;
		}
		setAppealLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: SubmitMarketplaceServiceListingAppealRequest = {
				name: appealListingId,
				appeal_reason: appealReason,
			};
			const resp = await fetch(
				`${baseUrl}/org/submit-marketplace-service-listing-appeal`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (resp.status === 200) {
				message.success(t("listings.success.appealed"));
				setAppealModalOpen(false);
				setAppealReason("");
				setAppealListingId("");
				loadListings(undefined, true);
			} else if (resp.status === 422) {
				message.error(t("listings.errors.appealAlreadyExhausted"));
			} else {
				message.error(t("listings.errors.appealFailed"));
			}
		} catch {
			message.error(t("listings.errors.appealFailed"));
		} finally {
			setAppealLoading(false);
		}
	};

	const columns = [
		{
			title: t("listings.table.name"),
			dataIndex: "name",
			key: "name",
		},
		{
			title: t("listings.table.category"),
			dataIndex: "service_category",
			key: "service_category",
			render: (cat: string) => t(`listings.serviceCategories.${cat}`),
		},
		{
			title: t("listings.table.state"),
			dataIndex: "state",
			key: "state",
			render: (state: ServiceListingState) => (
				<Tag color={stateColor(state)}>{t(`listings.states.${state}`)}</Tag>
			),
		},
		{
			title: t("listings.table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => new Date(v).toLocaleDateString(),
		},
		{
			title: t("listings.table.actions"),
			key: "actions",
			render: (_: unknown, record: ServiceListing) => {
				const id = record.name;
				const isLoading = actionLoadingId === id;
				return (
					<Space size="small" wrap>
						{canEdit(record.state) && (
							<Button
								size="small"
								onClick={() =>
									navigate(
										`/marketplace/service-listings/${encodeURIComponent(record.name)}/edit`
									)
								}
							>
								{t("listings.table.edit")}
							</Button>
						)}
						{record.state === "draft" && (
							<Button
								size="small"
								type="primary"
								loading={isLoading}
								onClick={() => handleSubmit(id)}
							>
								{t("listings.submit")}
							</Button>
						)}
						{record.state === "active" && (
							<Button
								size="small"
								loading={isLoading}
								onClick={() => handlePause(id)}
							>
								{t("listings.pause")}
							</Button>
						)}
						{record.state === "paused" && (
							<Button
								size="small"
								type="primary"
								loading={isLoading}
								onClick={() => handleUnpause(id)}
							>
								{t("listings.unpause")}
							</Button>
						)}
						{record.state === "suspended" && !record.appeal_exhausted && (
							<Button
								size="small"
								onClick={() => {
									setAppealListingId(id);
									setAppealModalOpen(true);
								}}
							>
								{t("listings.appeal")}
							</Button>
						)}
						{[
							"active",
							"paused",
							"rejected",
							"suspended",
							"appealing",
							"draft",
						].includes(record.state) && (
							<Button
								size="small"
								danger
								loading={isLoading}
								onClick={() => handleArchive(id)}
							>
								{t("listings.archive")}
							</Button>
						)}
					</Space>
				);
			},
		},
	];

	if (!hasCapability) {
		return (
			<Alert
				title={t("listings.noCapability")}
				type="warning"
				showIcon
				style={{ marginBottom: 16 }}
			/>
		);
	}

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
				<Link to="/marketplace/provider">
					<Button icon={<ArrowLeftOutlined />}>
						{t("listings.backToProvider")}
					</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 24,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("listings.title")}
				</Title>
				<Button
					type="primary"
					icon={<PlusOutlined />}
					onClick={() => navigate("/marketplace/service-listings/new")}
				>
					{t("listings.addButton")}
				</Button>
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={listings}
					columns={columns}
					rowKey="name"
					pagination={false}
					expandable={{
						expandedRowRender: (record) => (
							<div style={{ padding: "8px 0" }}>
								{record.last_review_admin_note && (
									<Alert
										title={`${t("listings.lastReviewNote")}: ${record.last_review_admin_note}`}
										type="info"
										style={{ marginBottom: 8 }}
									/>
								)}
								{record.appeal_exhausted && (
									<Alert
										title={t("listings.errors.appealAlreadyExhausted")}
										type="warning"
									/>
								)}
							</div>
						),
						rowExpandable: (record) =>
							!!(record.last_review_admin_note || record.appeal_exhausted),
					}}
					locale={{ emptyText: t("listings.noListings") }}
				/>
			</Spin>

			{nextCursor && (
				<Button
					onClick={() => loadListings(nextCursor, false)}
					loading={loading}
					block
					style={{ marginTop: 16 }}
				>
					{t("listings.loadMore")}
				</Button>
			)}

			{/* Appeal Modal */}
			<Modal
				title={t("listings.appeal")}
				open={appealModalOpen}
				onCancel={() => {
					setAppealModalOpen(false);
					setAppealReason("");
					setAppealListingId("");
				}}
				footer={null}
				destroyOnHidden
			>
				<Spin spinning={appealLoading}>
					<Form layout="vertical">
						<Form.Item label={t("listings.appealReason")} required>
							<TextArea
								rows={4}
								placeholder={t("listings.appealReasonPlaceholder")}
								value={appealReason}
								onChange={(e) => setAppealReason(e.target.value)}
								maxLength={2100}
							/>
							{appealReason.length > 2000 && (
								<Text type="danger">
									{t("listings.errors.appealReasonTooLong")}
								</Text>
							)}
						</Form.Item>
						<Button
							type="primary"
							loading={appealLoading}
							disabled={!appealReason.trim() || appealReason.length > 2000}
							onClick={handleAppeal}
							block
						>
							{t("listings.appeal")}
						</Button>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
