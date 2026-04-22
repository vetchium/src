import {
	ArrowLeftOutlined,
	EditOutlined,
	PlusOutlined,
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
	Table,
	Tag,
	Tabs,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AddCostCenterRequest,
	CostCenter,
	ListCostCentersRequest,
	UpdateCostCenterRequest,
} from "vetchium-specs/org/cost-centers";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;

type FilterStatus = "enabled" | "disabled" | undefined;

export function CostCentersPage() {
	const { t } = useTranslation("cost-centers");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_costcenters") ||
		false;

	const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextCursor, setNextCursor] = useState<string>("");
	const [filterStatus, setFilterStatus] = useState<FilterStatus>(undefined);

	const [addModalOpen, setAddModalOpen] = useState(false);
	const [addLoading, setAddLoading] = useState(false);
	const [addForm] = Form.useForm();

	const [editModalOpen, setEditModalOpen] = useState(false);
	const [editLoading, setEditLoading] = useState(false);
	const [editingCostCenter, setEditingCostCenter] = useState<CostCenter | null>(
		null
	);
	const [editForm] = Form.useForm();
	const [togglingId, setTogglingId] = useState<string | null>(null);

	const loadCostCenters = useCallback(
		async (cursor?: string, status?: FilterStatus, reset?: boolean) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListCostCentersRequest = {
					limit: 20,
					...(cursor ? { cursor } : {}),
					...(status ? { filter_status: status } : {}),
				};
				const resp = await fetch(`${baseUrl}/org/list-cost-centers`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					if (reset) {
						setCostCenters(data.items ?? []);
					} else {
						setCostCenters((prev) => [...prev, ...(data.items ?? [])]);
					}
					setNextCursor(data.next_cursor ?? "");
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	useEffect(() => {
		loadCostCenters(undefined, filterStatus, true);
	}, [filterStatus, loadCostCenters]);

	const handleTabChange = (key: string) => {
		const status: FilterStatus =
			key === "enabled"
				? "enabled"
				: key === "disabled"
					? "disabled"
					: undefined;
		setFilterStatus(status);
		setNextCursor("");
	};

	const handleLoadMore = () => {
		if (nextCursor) {
			loadCostCenters(nextCursor, filterStatus, false);
		}
	};

	const handleAdd = async (values: {
		id: string;
		display_name: string;
		notes?: string;
	}) => {
		if (!sessionToken) return;
		setAddLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: AddCostCenterRequest = {
				id: values.id,
				display_name: values.display_name,
				...(values.notes ? { notes: values.notes } : {}),
			};
			const resp = await fetch(`${baseUrl}/org/add-cost-center`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 201) {
				message.success(t("success.added"));
				setAddModalOpen(false);
				addForm.resetFields();
				loadCostCenters(undefined, filterStatus, true);
			} else if (resp.status === 409) {
				message.error(t("errors.duplicate"));
			} else if (resp.status === 400) {
				const errs = await resp.json().catch(() => []);
				if (Array.isArray(errs) && errs.length > 0) {
					message.error(errs[0].message ?? t("errors.addFailed"));
				} else {
					message.error(t("errors.addFailed"));
				}
			} else {
				message.error(t("errors.addFailed"));
			}
		} catch {
			message.error(t("errors.addFailed"));
		} finally {
			setAddLoading(false);
		}
	};

	const handleEdit = (cc: CostCenter) => {
		setEditingCostCenter(cc);
		editForm.setFieldsValue({
			id: cc.id,
			display_name: cc.display_name,
			status: cc.status,
			notes: cc.notes ?? "",
		});
		setEditModalOpen(true);
	};

	const handleUpdate = async (values: {
		id: string;
		display_name: string;
		status: "enabled" | "disabled";
		notes?: string;
	}) => {
		if (!sessionToken || !editingCostCenter) return;
		setEditLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: UpdateCostCenterRequest = {
				id: editingCostCenter.id,
				display_name: values.display_name,
				status: values.status,
				...(values.notes ? { notes: values.notes } : {}),
			};
			const resp = await fetch(`${baseUrl}/org/update-cost-center`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("success.updated"));
				setEditModalOpen(false);
				editForm.resetFields();
				setEditingCostCenter(null);
				loadCostCenters(undefined, filterStatus, true);
			} else if (resp.status === 404) {
				message.error(t("errors.notFound"));
			} else if (resp.status === 400) {
				const errs = await resp.json().catch(() => []);
				if (Array.isArray(errs) && errs.length > 0) {
					message.error(errs[0].message ?? t("errors.updateFailed"));
				} else {
					message.error(t("errors.updateFailed"));
				}
			} else {
				message.error(t("errors.updateFailed"));
			}
		} catch {
			message.error(t("errors.updateFailed"));
		} finally {
			setEditLoading(false);
		}
	};

	const handleToggleStatus = async (cc: CostCenter) => {
		if (!sessionToken) return;
		const newStatus = cc.status === "enabled" ? "disabled" : "enabled";
		setTogglingId(cc.id);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: UpdateCostCenterRequest = {
				id: cc.id,
				display_name: cc.display_name,
				status: newStatus,
				...(cc.notes ? { notes: cc.notes } : {}),
			};
			const resp = await fetch(`${baseUrl}/org/update-cost-center`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("success.updated"));
				loadCostCenters(undefined, filterStatus, true);
			} else if (resp.status === 404) {
				message.error(t("errors.notFound"));
			} else {
				message.error(t("errors.updateFailed"));
			}
		} catch {
			message.error(t("errors.updateFailed"));
		} finally {
			setTogglingId(null);
		}
	};

	const columns = [
		{
			title: t("table.displayName"),
			dataIndex: "display_name",
			key: "display_name",
		},
		{
			title: t("table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={status === "enabled" ? "green" : "default"}>
					{t(`status.${status}`)}
				</Tag>
			),
		},
		{
			title: t("table.notes"),
			dataIndex: "notes",
			key: "notes",
			render: (notes: string | undefined) => notes ?? "-",
		},
		{
			title: t("table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (createdAt: string) => new Date(createdAt).toLocaleString(),
		},
		...(canManage
			? [
					{
						title: t("table.actions"),
						key: "actions",
						render: (_: unknown, record: CostCenter) => (
							<Space>
								<Button
									icon={<EditOutlined />}
									size="small"
									onClick={() => handleEdit(record)}
								>
									{t("table.edit")}
								</Button>
								<Button
									size="small"
									loading={togglingId === record.id}
									onClick={() => handleToggleStatus(record)}
								>
									{record.status === "enabled"
										? t("table.disable")
										: t("table.enable")}
								</Button>
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
					{t("title")}
				</Title>
				{canManage && (
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => setAddModalOpen(true)}
					>
						{t("addButton")}
					</Button>
				)}
			</div>

			<Tabs
				defaultActiveKey="all"
				onChange={handleTabChange}
				items={[
					{ key: "all", label: t("filter.all") },
					{ key: "enabled", label: t("filter.enabled") },
					{ key: "disabled", label: t("filter.disabled") },
				]}
			/>

			<Spin spinning={loading}>
				<Table
					dataSource={costCenters}
					columns={columns}
					rowKey="id"
					pagination={false}
					locale={{ emptyText: t("table.id") }}
				/>
			</Spin>

			{nextCursor && (
				<Button onClick={handleLoadMore} loading={loading} block>
					{t("loadMore")}
				</Button>
			)}

			{/* Add Cost Center Modal */}
			<Modal
				title={t("addModal.title")}
				open={addModalOpen}
				onCancel={() => {
					setAddModalOpen(false);
					addForm.resetFields();
				}}
				footer={null}
				destroyOnHidden
			>
				<Spin spinning={addLoading}>
					<Form form={addForm} layout="vertical" onFinish={handleAdd}>
						<Form.Item
							name="id"
							label={t("addModal.idLabel")}
							help={t("addModal.idHelp")}
							rules={[
								{ required: true, message: t("errors.idRequired") },
								{ max: 64, message: t("errors.idTooLong") },
								{
									pattern: /^[a-z0-9][a-z0-9_-]*$/,
									message: t("errors.idInvalid"),
								},
							]}
						>
							<Input placeholder={t("addModal.idPlaceholder")} />
						</Form.Item>

						<Form.Item
							name="display_name"
							label={t("addModal.displayNameLabel")}
							rules={[
								{ required: true, message: t("errors.displayNameRequired") },
								{ max: 64, message: t("errors.displayNameTooLong") },
							]}
						>
							<Input placeholder={t("addModal.displayNamePlaceholder")} />
						</Form.Item>

						<Form.Item
							name="notes"
							label={t("addModal.notesLabel")}
							rules={[{ max: 500, message: t("errors.notesTooLong") }]}
						>
							<Input.TextArea
								placeholder={t("addModal.notesPlaceholder")}
								rows={3}
							/>
						</Form.Item>

						<Form.Item shouldUpdate>
							{() => (
								<Button
									type="primary"
									htmlType="submit"
									loading={addLoading}
									disabled={addForm
										.getFieldsError()
										.some(({ errors }) => errors.length > 0)}
									block
								>
									{t("addModal.submitButton")}
								</Button>
							)}
						</Form.Item>
					</Form>
				</Spin>
			</Modal>

			{/* Edit Cost Center Modal */}
			<Modal
				title={t("editModal.title")}
				open={editModalOpen}
				onCancel={() => {
					setEditModalOpen(false);
					editForm.resetFields();
					setEditingCostCenter(null);
				}}
				footer={null}
				destroyOnHidden
			>
				<Spin spinning={editLoading}>
					<Form form={editForm} layout="vertical" onFinish={handleUpdate}>
						<Form.Item
							name="id"
							label={t("editModal.idLabel")}
							help={t("editModal.idHelp")}
						>
							<Input disabled />
						</Form.Item>

						<Form.Item
							name="display_name"
							label={t("editModal.displayNameLabel")}
							rules={[
								{ required: true, message: t("errors.displayNameRequired") },
								{ max: 64, message: t("errors.displayNameTooLong") },
							]}
						>
							<Input placeholder={t("editModal.displayNamePlaceholder")} />
						</Form.Item>

						<Form.Item
							name="status"
							label={t("editModal.statusLabel")}
							rules={[{ required: true }]}
						>
							<Select
								options={[
									{ value: "enabled", label: t("editModal.statusEnabled") },
									{ value: "disabled", label: t("editModal.statusDisabled") },
								]}
							/>
						</Form.Item>

						<Form.Item
							name="notes"
							label={t("editModal.notesLabel")}
							rules={[{ max: 500, message: t("errors.notesTooLong") }]}
						>
							<Input.TextArea
								placeholder={t("editModal.notesPlaceholder")}
								rows={3}
							/>
						</Form.Item>

						<Form.Item shouldUpdate>
							{() => (
								<Button
									type="primary"
									htmlType="submit"
									loading={editLoading}
									disabled={editForm
										.getFieldsError()
										.some(({ errors }) => errors.length > 0)}
									block
								>
									{t("editModal.submitButton")}
								</Button>
							)}
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
