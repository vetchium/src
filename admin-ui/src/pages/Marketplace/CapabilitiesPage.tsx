import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
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
	CapabilityStatus,
	MarketplaceCapability,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;
const { TextArea } = Input;

const STATUS_COLORS: Record<CapabilityStatus, string> = {
	draft: "default",
	active: "success",
	disabled: "error",
};

const VALID_STATUSES: CapabilityStatus[] = ["draft", "active", "disabled"];

export function CapabilitiesPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();
	const [createForm] = Form.useForm();
	const [editForm] = Form.useForm();

	const canManage =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:manage_marketplace") ||
		false;

	const [capabilities, setCapabilities] = useState<MarketplaceCapability[]>([]);
	const [loading, setLoading] = useState(false);
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [editModalOpen, setEditModalOpen] = useState(false);
	const [selectedCap, setSelectedCap] = useState<MarketplaceCapability | null>(
		null
	);
	const [submitting, setSubmitting] = useState(false);

	const loadCapabilities = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/admin/marketplace/capability/list`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ limit: 100 }),
			});
			if (resp.status === 200) {
				const data = await resp.json();
				setCapabilities(data.capabilities || []);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken]);

	useEffect(() => {
		loadCapabilities();
	}, [loadCapabilities]);

	const handleCreate = async (values: {
		capability_id: string;
		display_name: string;
		description?: string;
	}) => {
		if (!sessionToken) return;
		setSubmitting(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/admin/marketplace/capability/create`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(values),
				}
			);
			if (resp.status === 201) {
				message.success(t("capabilities.createSuccess"));
				setCreateModalOpen(false);
				createForm.resetFields();
				loadCapabilities();
			} else if (resp.status === 400) {
				const errs = await resp.json();
				message.error(
					errs.map((e: { message: string }) => e.message).join(", ")
				);
			} else if (resp.status === 409) {
				message.error(t("capabilities.idConflict"));
			} else {
				message.error(t("capabilities.createError"));
			}
		} finally {
			setSubmitting(false);
		}
	};

	const handleEdit = async (values: {
		status: CapabilityStatus;
		display_name?: string;
		description?: string;
	}) => {
		if (!sessionToken || !selectedCap) return;
		setSubmitting(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/admin/marketplace/capability/update`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						capability_id: selectedCap.capability_id,
						...values,
					}),
				}
			);
			if (resp.status === 200) {
				message.success(t("capabilities.updateSuccess"));
				setEditModalOpen(false);
				editForm.resetFields();
				setSelectedCap(null);
				loadCapabilities();
			} else if (resp.status === 400) {
				const errs = await resp.json();
				message.error(
					errs.map((e: { message: string }) => e.message).join(", ")
				);
			} else {
				message.error(t("capabilities.updateError"));
			}
		} finally {
			setSubmitting(false);
		}
	};

	const openEdit = (cap: MarketplaceCapability) => {
		setSelectedCap(cap);
		editForm.setFieldsValue({
			status: cap.status,
			display_name: cap.display_name,
			description: cap.description,
		});
		setEditModalOpen(true);
	};

	const columns = [
		{
			title: t("capabilities.id"),
			dataIndex: "capability_id",
			key: "capability_id",
		},
		{
			title: t("capabilities.displayName"),
			dataIndex: "display_name",
			key: "display_name",
		},
		{
			title: t("capabilities.status"),
			dataIndex: "status",
			key: "status",
			render: (status: CapabilityStatus) => (
				<Tag color={STATUS_COLORS[status]}>{t(`capStatus.${status}`)}</Tag>
			),
		},
		...(canManage
			? [
					{
						title: t("capabilities.actions"),
						key: "actions",
						render: (_: unknown, record: MarketplaceCapability) => (
							<Button size="small" onClick={() => openEdit(record)}>
								{t("capabilities.edit")}
							</Button>
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
					<Button icon={<ArrowLeftOutlined />}>
						{t("backToDashboard")}
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
					{t("capabilities.title")}
				</Title>
				{canManage && (
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => setCreateModalOpen(true)}
					>
						{t("capabilities.create")}
					</Button>
				)}
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={capabilities}
					columns={columns}
					rowKey="capability_id"
					pagination={false}
				/>
			</Spin>

			{/* Create modal */}
			<Modal
				open={createModalOpen}
				title={t("capabilities.createTitle")}
				onOk={() => createForm.submit()}
				onCancel={() => {
					setCreateModalOpen(false);
					createForm.resetFields();
				}}
				confirmLoading={submitting}
				okText={t("capabilities.createSubmit")}
			>
				<Form form={createForm} layout="vertical" onFinish={handleCreate}>
					<Form.Item
						name="capability_id"
						label={t("capabilities.id")}
						rules={[
							{ required: true, message: t("capabilities.idRequired") },
							{
								pattern: /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/,
								message: t("capabilities.idPattern"),
							},
						]}
					>
						<Input placeholder="e.g. data-analytics" />
					</Form.Item>
					<Form.Item
						name="display_name"
						label={t("capabilities.displayName")}
						rules={[
							{
								required: true,
								message: t("capabilities.displayNameRequired"),
							},
						]}
					>
						<Input />
					</Form.Item>
					<Form.Item name="description" label={t("capabilities.description")}>
						<TextArea rows={3} />
					</Form.Item>
				</Form>
			</Modal>

			{/* Edit modal */}
			<Modal
				open={editModalOpen}
				title={t("capabilities.editTitle")}
				onOk={() => editForm.submit()}
				onCancel={() => {
					setEditModalOpen(false);
					editForm.resetFields();
					setSelectedCap(null);
				}}
				confirmLoading={submitting}
				okText={t("capabilities.updateSubmit")}
			>
				<Form form={editForm} layout="vertical" onFinish={handleEdit}>
					<Form.Item
						name="status"
						label={t("capabilities.status")}
						rules={[
							{ required: true, message: t("capabilities.statusRequired") },
						]}
					>
						<Select
							options={VALID_STATUSES.map((s) => ({
								value: s,
								label: t(`capStatus.${s}`),
							}))}
						/>
					</Form.Item>
					<Form.Item
						name="display_name"
						label={t("capabilities.displayName")}
					>
						<Input />
					</Form.Item>
					<Form.Item name="description" label={t("capabilities.description")}>
						<TextArea rows={3} />
					</Form.Item>
				</Form>
			</Modal>
		</div>
	);
}
