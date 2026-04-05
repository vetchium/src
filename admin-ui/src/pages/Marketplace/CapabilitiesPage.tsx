import {
	ArrowLeftOutlined,
	CheckOutlined,
	PlusOutlined,
	StopOutlined,
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
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AdminMarketplaceCapability,
	AdminListCapabilitiesResponse,
	AdminCreateCapabilityRequest,
} from "vetchium-specs/admin/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { statusColor } from "./marketplaceUtils";

const { Title } = Typography;
const { TextArea } = Input;

export function CapabilitiesPage() {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const canManage =
		myInfo?.roles.includes("admin:manage_marketplace") ||
		myInfo?.roles.includes("admin:superadmin") ||
		false;

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
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 24,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("tabs.capabilities")}
				</Title>
				{canManage && (
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => setCreateModalOpen(true)}
					>
						{t("capabilities.createButton")}
					</Button>
				)}
			</div>

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
