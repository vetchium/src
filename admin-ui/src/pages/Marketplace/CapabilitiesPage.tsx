import {
	ArrowLeftOutlined,
	CheckOutlined,
	PlusOutlined,
	StopOutlined,
	EditOutlined,
} from "@ant-design/icons";
import {
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
	Tabs,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AdminMarketplaceCapability,
	AdminListCapabilitiesResponse,
	AdminCreateCapabilityRequest,
	AdminUpdateCapabilityRequest,
} from "vetchium-specs/admin/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { statusColor } from "./marketplaceUtils";

const { Title } = Typography;
const { TextArea } = Input;

const SUPPORTED_LOCALES = ["en-US", "de-DE", "ta-IN"];

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

	const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
	const [selectedCapability, setSelectedCapability] =
		useState<AdminMarketplaceCapability | null>(null);
	const [modalLoading, setModalLoading] = useState(false);
	const [form] = Form.useForm();

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
		const id = capability.capability_id;
		setActionLoading((prev) => ({ ...prev, [id]: true }));
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
				body: JSON.stringify({ capability_id: id }),
			});
			if (resp.status === 200) {
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
			message.error(t("capabilities.errors.actionFailed"));
		} finally {
			setActionLoading((prev) => ({ ...prev, [id]: false }));
		}
	}

	async function handleSubmit(values: any) {
		setModalLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();

			// Transform flat form values to translations array
			const translations = SUPPORTED_LOCALES.map((locale) => ({
				locale,
				display_name: values[`name_${locale}`],
				description: values[`desc_${locale}`] || "",
			})).filter((t) => t.display_name); // Only include if name is provided

			let endpoint = "";
			let body: any = {};

			if (modalMode === "create") {
				endpoint = "/admin/marketplace/capabilities/create";
				body = {
					capability_id: values.capability_id,
					status: "draft",
					translations,
				} as AdminCreateCapabilityRequest;
			} else {
				endpoint = "/admin/marketplace/capabilities/update";
				body = {
					capability_id: selectedCapability!.capability_id,
					translations,
				} as AdminUpdateCapabilityRequest;
			}

			const resp = await fetch(`${apiBaseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});

			if (resp.status === 200 || resp.status === 201) {
				message.success(
					t(
						`capabilities.success.${modalMode === "create" ? "created" : "updated"}`
					)
				);
				setModalMode(null);
				form.resetFields();
				fetchCapabilities(true);
			} else if (resp.status === 409) {
				message.error(t("capabilities.errors.conflict"));
			} else {
				message.error(
					t(
						`capabilities.errors.${modalMode === "create" ? "create" : "update"}Failed`
					)
				);
			}
		} catch {
			message.error(t("capabilities.errors.actionFailed"));
		} finally {
			setModalLoading(false);
		}
	}

	const openEditModal = (capability: AdminMarketplaceCapability) => {
		setSelectedCapability(capability);
		setModalMode("edit");

		// Fill form with existing translations
		const initialValues: any = {};
		capability.translations.forEach((tr) => {
			initialValues[`name_${tr.locale}`] = tr.display_name;
			initialValues[`desc_${tr.locale}`] = tr.description;
		});
		form.setFieldsValue(initialValues);
	};

	const columns = [
		{
			title: t("capabilities.table.id"),
			dataIndex: "capability_id",
			key: "capability_id",
		},
		{
			title: t("capabilities.table.displayName"),
			key: "display_name",
			render: (record: AdminMarketplaceCapability) => {
				const enUs = record.translations.find((t) => t.locale === "en-US");
				return enUs?.display_name || record.capability_id;
			},
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
								<Button
									size="small"
									icon={<EditOutlined />}
									onClick={() => openEditModal(record)}
								>
									{t("actions.edit")}
								</Button>
								{record.status === "active" ? (
									<Button
										size="small"
										icon={<StopOutlined />}
										danger
										loading={actionLoading[record.capability_id]}
										onClick={() => handleToggleStatus(record, false)}
									>
										{t("capabilities.actions.disable")}
									</Button>
								) : (
									<Button
										size="small"
										icon={<CheckOutlined />}
										loading={actionLoading[record.capability_id]}
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
						onClick={() => {
							setModalMode("create");
							setSelectedCapability(null);
							form.resetFields();
						}}
					>
						{t("capabilities.createButton")}
					</Button>
				)}
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={capabilities}
					columns={columns}
					rowKey="capability_id"
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
				title={
					modalMode === "create"
						? t("capabilities.createModal.title")
						: t("capabilities.editModal.title")
				}
				open={!!modalMode}
				onCancel={() => setModalMode(null)}
				footer={null}
				width={700}
			>
				<Spin spinning={modalLoading}>
					<Form form={form} layout="vertical" onFinish={handleSubmit}>
						{modalMode === "create" && (
							<Form.Item
								name="capability_id"
								label={t("capabilities.createModal.id")}
								rules={[
									{ required: true },
									{
										pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
										message: "Invalid ID format",
									},
								]}
							>
								<Input placeholder="e.g. talent-sourcing" />
							</Form.Item>
						)}

						<Tabs defaultActiveKey="en-US">
							{SUPPORTED_LOCALES.map((locale) => (
								<Tabs.TabPane tab={locale} key={locale}>
									<Form.Item
										name={`name_${locale}`}
										label={t("capabilities.createModal.displayName")}
										rules={[{ required: locale === "en-US" }]}
									>
										<Input />
									</Form.Item>
									<Form.Item
										name={`desc_${locale}`}
										label={t("capabilities.createModal.description")}
									>
										<TextArea rows={4} />
									</Form.Item>
								</Tabs.TabPane>
							))}
						</Tabs>

						<Form.Item style={{ marginTop: 24 }}>
							<Space>
								<Button type="primary" htmlType="submit">
									{t("submit")}
								</Button>
								<Button onClick={() => setModalMode(null)}>
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
