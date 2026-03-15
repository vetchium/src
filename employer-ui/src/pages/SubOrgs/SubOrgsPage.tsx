import {
	ArrowLeftOutlined,
	EditOutlined,
	PlusOutlined,
	TeamOutlined,
} from "@ant-design/icons";
import {
	App,
	Button,
	Drawer,
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
	SubOrg,
	SubOrgMember,
	CreateSubOrgRequest,
	RenameSubOrgRequest,
	DisableSubOrgRequest,
	EnableSubOrgRequest,
	AddSubOrgMemberRequest,
	RemoveSubOrgMemberRequest,
	ListSubOrgsRequest,
	ListSubOrgMembersRequest,
} from "vetchium-specs/employer/suborgs";
import type {
	FilterOrgUsersRequest,
	OrgUser,
} from "vetchium-specs/employer/employer-users";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;

type FilterStatus = "active" | "disabled" | undefined;

export function SubOrgsPage() {
	const { t } = useTranslation("suborgs");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();

	const canManage =
		myInfo?.roles.includes("employer:superadmin") ||
		myInfo?.roles.includes("employer:manage_suborgs") ||
		false;

	const canViewMembers =
		canManage || myInfo?.roles.includes("employer:view_suborgs") || false;

	// --- list suborgs ---
	const [suborgs, setSuborgs] = useState<SubOrg[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextCursor, setNextCursor] = useState<string>("");
	const [filterStatus, setFilterStatus] = useState<FilterStatus>(undefined);

	// --- create suborg ---
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [createLoading, setCreateLoading] = useState(false);
	const [createForm] = Form.useForm();

	// --- rename suborg ---
	const [renameModalOpen, setRenameModalOpen] = useState(false);
	const [renameLoading, setRenameLoading] = useState(false);
	const [renamingSuborg, setRenamingSuborg] = useState<SubOrg | null>(null);
	const [renameForm] = Form.useForm();

	// --- disable/enable ---
	const [togglingId, setTogglingId] = useState<string | null>(null);

	// --- members drawer ---
	const [membersDrawerOpen, setMembersDrawerOpen] = useState(false);
	const [selectedSuborg, setSelectedSuborg] = useState<SubOrg | null>(null);
	const [members, setMembers] = useState<SubOrgMember[]>([]);
	const [membersLoading, setMembersLoading] = useState(false);
	const [membersCursor, setMembersCursor] = useState<string>("");

	// --- add member ---
	const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
	const [addMemberLoading, setAddMemberLoading] = useState(false);
	const [userSearchResults, setUserSearchResults] = useState<OrgUser[]>([]);
	const [userSearchLoading, setUserSearchLoading] = useState(false);
	const [selectedUserId, setSelectedUserId] = useState<string | undefined>(
		undefined
	);

	// --- remove member ---
	const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

	const loadSuborgs = useCallback(
		async (cursor?: string, status?: FilterStatus, reset?: boolean) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListSubOrgsRequest = {
					limit: 20,
					...(cursor ? { cursor } : {}),
					...(status ? { filter_status: status } : {}),
				};
				const resp = await fetch(`${baseUrl}/employer/list-suborgs`, {
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
						setSuborgs(data.suborgs ?? []);
					} else {
						setSuborgs((prev) => [...prev, ...(data.suborgs ?? [])]);
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
		loadSuborgs(undefined, filterStatus, true);
	}, [filterStatus, loadSuborgs]);

	const handleTabChange = (key: string) => {
		const status: FilterStatus =
			key === "active" ? "active" : key === "disabled" ? "disabled" : undefined;
		setFilterStatus(status);
		setNextCursor("");
	};

	const handleCreate = async (values: {
		name: string;
		pinned_region: string;
	}) => {
		if (!sessionToken) return;
		setCreateLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: CreateSubOrgRequest = {
				name: values.name,
				pinned_region: values.pinned_region,
			};
			const resp = await fetch(`${baseUrl}/employer/create-suborg`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 201) {
				message.success(t("success.created"));
				setCreateModalOpen(false);
				createForm.resetFields();
				loadSuborgs(undefined, filterStatus, true);
			} else if (resp.status === 409) {
				message.error(t("errors.limitReached"));
			} else if (resp.status === 400) {
				const errs = await resp.json().catch(() => []);
				if (Array.isArray(errs) && errs.length > 0) {
					message.error(errs[0].message ?? t("errors.createFailed"));
				} else {
					message.error(t("errors.createFailed"));
				}
			} else {
				message.error(t("errors.createFailed"));
			}
		} catch {
			message.error(t("errors.createFailed"));
		} finally {
			setCreateLoading(false);
		}
	};

	const openRenameModal = (suborg: SubOrg) => {
		setRenamingSuborg(suborg);
		renameForm.setFieldsValue({ name: suborg.name });
		setRenameModalOpen(true);
	};

	const handleRename = async (values: { name: string }) => {
		if (!sessionToken || !renamingSuborg) return;
		setRenameLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: RenameSubOrgRequest = {
				suborg_id: renamingSuborg.id,
				name: values.name,
			};
			const resp = await fetch(`${baseUrl}/employer/rename-suborg`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("success.renamed"));
				setRenameModalOpen(false);
				renameForm.resetFields();
				setRenamingSuborg(null);
				loadSuborgs(undefined, filterStatus, true);
			} else if (resp.status === 404) {
				message.error(t("errors.notFound"));
			} else {
				message.error(t("errors.renameFailed"));
			}
		} catch {
			message.error(t("errors.renameFailed"));
		} finally {
			setRenameLoading(false);
		}
	};

	const handleToggleStatus = async (suborg: SubOrg) => {
		if (!sessionToken) return;
		setTogglingId(suborg.id);
		try {
			const baseUrl = await getApiBaseUrl();
			const endpoint =
				suborg.status === "active"
					? "/employer/disable-suborg"
					: "/employer/enable-suborg";
			const req: DisableSubOrgRequest | EnableSubOrgRequest = {
				suborg_id: suborg.id,
			};
			const resp = await fetch(`${baseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(
					suborg.status === "active"
						? t("success.disabled")
						: t("success.enabled")
				);
				loadSuborgs(undefined, filterStatus, true);
			} else if (resp.status === 404) {
				message.error(t("errors.notFound"));
			} else if (resp.status === 422) {
				message.error(t("errors.invalidState"));
			} else {
				message.error(t("errors.toggleFailed"));
			}
		} catch {
			message.error(t("errors.toggleFailed"));
		} finally {
			setTogglingId(null);
		}
	};

	const loadMembers = useCallback(
		async (suborgId: string, cursor?: string, reset?: boolean) => {
			if (!sessionToken) return;
			setMembersLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListSubOrgMembersRequest = {
					suborg_id: suborgId,
					limit: 20,
					...(cursor ? { cursor } : {}),
				};
				const resp = await fetch(`${baseUrl}/employer/list-suborg-members`, {
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
						setMembers(data.members ?? []);
					} else {
						setMembers((prev) => [...prev, ...(data.members ?? [])]);
					}
					setMembersCursor(data.next_cursor ?? "");
				} else {
					message.error(t("errors.loadMembersFailed"));
				}
			} catch {
				message.error(t("errors.loadMembersFailed"));
			} finally {
				setMembersLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	const openMembersDrawer = (suborg: SubOrg) => {
		setSelectedSuborg(suborg);
		setMembers([]);
		setMembersCursor("");
		setMembersDrawerOpen(true);
		loadMembers(suborg.id, undefined, true);
	};

	const handleSearchUsers = async (query: string) => {
		if (!sessionToken || !query.trim()) {
			setUserSearchResults([]);
			return;
		}
		setUserSearchLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: FilterOrgUsersRequest = {
				filter_name: query,
				limit: 10,
			};
			const resp = await fetch(`${baseUrl}/employer/filter-users`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				const data = await resp.json();
				setUserSearchResults(data.items ?? []);
			}
		} catch {
			// ignore search errors silently
		} finally {
			setUserSearchLoading(false);
		}
	};

	const handleAddMember = async () => {
		if (!sessionToken || !selectedSuborg || !selectedUserId) return;
		setAddMemberLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: AddSubOrgMemberRequest = {
				suborg_id: selectedSuborg.id,
				email_address: selectedUserId,
			};
			const resp = await fetch(`${baseUrl}/employer/add-suborg-member`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("success.memberAdded"));
				setAddMemberModalOpen(false);
				setSelectedUserId(undefined);
				setUserSearchResults([]);
				loadMembers(selectedSuborg.id, undefined, true);
			} else if (resp.status === 409) {
				message.error(t("errors.memberAlreadyAdded"));
			} else if (resp.status === 404) {
				message.error(t("errors.memberNotFound"));
			} else {
				message.error(t("errors.addMemberFailed"));
			}
		} catch {
			message.error(t("errors.addMemberFailed"));
		} finally {
			setAddMemberLoading(false);
		}
	};

	const handleRemoveMember = async (member: SubOrgMember) => {
		if (!sessionToken || !selectedSuborg) return;
		setRemovingMemberId(member.email_address);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: RemoveSubOrgMemberRequest = {
				suborg_id: selectedSuborg.id,
				email_address: member.email_address,
			};
			const resp = await fetch(`${baseUrl}/employer/remove-suborg-member`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("success.memberRemoved"));
				loadMembers(selectedSuborg.id, undefined, true);
			} else if (resp.status === 404) {
				message.error(t("errors.memberNotFound"));
			} else {
				message.error(t("errors.removeMemberFailed"));
			}
		} catch {
			message.error(t("errors.removeMemberFailed"));
		} finally {
			setRemovingMemberId(null);
		}
	};

	const columns = [
		{
			title: t("table.name"),
			dataIndex: "name",
			key: "name",
		},
		{
			title: t("table.pinnedRegion"),
			dataIndex: "pinned_region",
			key: "pinned_region",
		},
		{
			title: t("table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={status === "active" ? "green" : "default"}>
					{t(`status.${status}`)}
				</Tag>
			),
		},
		{
			title: t("table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (val: string) => new Date(val).toLocaleString(),
		},
		{
			title: t("table.actions"),
			key: "actions",
			render: (_: unknown, record: SubOrg) => (
				<Space wrap>
					{canViewMembers && (
						<Button
							icon={<TeamOutlined />}
							size="small"
							onClick={() => openMembersDrawer(record)}
						>
							{t("table.members")}
						</Button>
					)}
					{canManage && (
						<>
							<Button
								icon={<EditOutlined />}
								size="small"
								onClick={() => openRenameModal(record)}
							>
								{t("table.rename")}
							</Button>
							<Button
								size="small"
								loading={togglingId === record.id}
								onClick={() => handleToggleStatus(record)}
							>
								{record.status === "active"
									? t("table.disable")
									: t("table.enable")}
							</Button>
						</>
					)}
				</Space>
			),
		},
	];

	const memberColumns = [
		{
			title: t("members.name"),
			dataIndex: "name",
			key: "name",
		},
		{
			title: t("members.assignedAt"),
			dataIndex: "assigned_at",
			key: "assigned_at",
			render: (val: string) => new Date(val).toLocaleString(),
		},
		...(canManage
			? [
					{
						title: t("members.actions"),
						key: "actions",
						render: (_: unknown, record: SubOrgMember) => (
							<Button
								size="small"
								danger
								loading={removingMemberId === record.email_address}
								onClick={() => handleRemoveMember(record)}
							>
								{t("members.remove")}
							</Button>
						),
					},
				]
			: []),
	];

	return (
		<div style={{ maxWidth: 1000, width: "100%", padding: "24px 16px" }}>
			<Space orientation="vertical" size="large" style={{ width: "100%" }}>
				<Space>
					<Link to="/">
						<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
					</Link>
				</Space>

				<Space
					align="center"
					style={{ justifyContent: "space-between", width: "100%" }}
				>
					<Space>
						<TeamOutlined style={{ fontSize: 24, color: "#fa8c16" }} />
						<Title level={3} style={{ margin: 0 }}>
							{t("title")}
						</Title>
					</Space>
					{canManage && (
						<Button
							type="primary"
							icon={<PlusOutlined />}
							onClick={() => setCreateModalOpen(true)}
						>
							{t("createButton")}
						</Button>
					)}
				</Space>

				<Tabs
					defaultActiveKey="all"
					onChange={handleTabChange}
					items={[
						{ key: "all", label: t("filter.all") },
						{ key: "active", label: t("filter.active") },
						{ key: "disabled", label: t("filter.disabled") },
					]}
				/>

				<Spin spinning={loading}>
					<Table
						dataSource={suborgs}
						columns={columns}
						rowKey="id"
						pagination={false}
						locale={{ emptyText: t("table.empty") }}
					/>
				</Spin>

				{nextCursor && (
					<Button
						onClick={() => loadSuborgs(nextCursor, filterStatus, false)}
						loading={loading}
						block
					>
						{t("loadMore")}
					</Button>
				)}
			</Space>

			{/* Create SubOrg Modal */}
			<Modal
				title={t("createModal.title")}
				open={createModalOpen}
				onCancel={() => {
					setCreateModalOpen(false);
					createForm.resetFields();
				}}
				footer={null}
				destroyOnHidden
			>
				<Spin spinning={createLoading}>
					<Form form={createForm} layout="vertical" onFinish={handleCreate}>
						<Form.Item
							name="name"
							label={t("createModal.nameLabel")}
							rules={[
								{ required: true, message: t("errors.nameRequired") },
								{ max: 64, message: t("errors.nameTooLong") },
							]}
						>
							<Input placeholder={t("createModal.namePlaceholder")} />
						</Form.Item>

						<Form.Item
							name="pinned_region"
							label={t("createModal.regionLabel")}
							rules={[{ required: true, message: t("errors.regionRequired") }]}
						>
							<Select
								options={[
									{ value: "ind1", label: t("regions.ind1") },
									{ value: "usa1", label: t("regions.usa1") },
									{ value: "deu1", label: t("regions.deu1") },
									{ value: "sgp1", label: t("regions.sgp1") },
								]}
								placeholder={t("createModal.regionPlaceholder")}
							/>
						</Form.Item>

						<Form.Item shouldUpdate>
							{() => (
								<Button
									type="primary"
									htmlType="submit"
									loading={createLoading}
									disabled={createForm
										.getFieldsError()
										.some(({ errors }) => errors.length > 0)}
									block
								>
									{t("createModal.submitButton")}
								</Button>
							)}
						</Form.Item>
					</Form>
				</Spin>
			</Modal>

			{/* Rename SubOrg Modal */}
			<Modal
				title={t("renameModal.title")}
				open={renameModalOpen}
				onCancel={() => {
					setRenameModalOpen(false);
					renameForm.resetFields();
					setRenamingSuborg(null);
				}}
				footer={null}
				destroyOnHidden
			>
				<Spin spinning={renameLoading}>
					<Form form={renameForm} layout="vertical" onFinish={handleRename}>
						<Form.Item
							name="name"
							label={t("renameModal.nameLabel")}
							rules={[
								{ required: true, message: t("errors.nameRequired") },
								{ max: 64, message: t("errors.nameTooLong") },
							]}
						>
							<Input placeholder={t("renameModal.namePlaceholder")} />
						</Form.Item>

						<Form.Item shouldUpdate>
							{() => (
								<Button
									type="primary"
									htmlType="submit"
									loading={renameLoading}
									disabled={renameForm
										.getFieldsError()
										.some(({ errors }) => errors.length > 0)}
									block
								>
									{t("renameModal.submitButton")}
								</Button>
							)}
						</Form.Item>
					</Form>
				</Spin>
			</Modal>

			{/* Members Drawer */}
			<Drawer
				title={
					selectedSuborg
						? t("membersDrawer.title", { name: selectedSuborg.name })
						: t("membersDrawer.defaultTitle")
				}
				open={membersDrawerOpen}
				onClose={() => {
					setMembersDrawerOpen(false);
					setSelectedSuborg(null);
					setMembers([]);
				}}
				size="large"
				extra={
					canManage && (
						<Button
							type="primary"
							icon={<PlusOutlined />}
							onClick={() => {
								setSelectedUserId(undefined);
								setUserSearchResults([]);
								setAddMemberModalOpen(true);
							}}
						>
							{t("members.addButton")}
						</Button>
					)
				}
			>
				<Spin spinning={membersLoading}>
					<Table
						dataSource={members}
						columns={memberColumns}
						rowKey="email_address"
						pagination={false}
						locale={{ emptyText: t("members.empty") }}
					/>
				</Spin>
				{membersCursor && (
					<Button
						onClick={() =>
							selectedSuborg &&
							loadMembers(selectedSuborg.id, membersCursor, false)
						}
						loading={membersLoading}
						block
						style={{ marginTop: 16 }}
					>
						{t("loadMore")}
					</Button>
				)}
			</Drawer>

			{/* Add Member Modal */}
			<Modal
				title={t("addMemberModal.title")}
				open={addMemberModalOpen}
				onCancel={() => {
					setAddMemberModalOpen(false);
					setSelectedUserId(undefined);
					setUserSearchResults([]);
				}}
				footer={null}
				destroyOnHidden
			>
				<Space orientation="vertical" style={{ width: "100%" }} size="large">
					<Select
						showSearch={{ filterOption: false, onSearch: handleSearchUsers }}
						style={{ width: "100%" }}
						placeholder={t("addMemberModal.searchPlaceholder")}
						onChange={(val: string) => setSelectedUserId(val)}
						loading={userSearchLoading}
						options={userSearchResults.map((u) => ({
							value: String(u.email_address),
							label: u.name
								? `${u.name} (${u.email_address})`
								: u.email_address,
						}))}
						notFoundContent={
							userSearchLoading ? (
								<Spin size="small" />
							) : (
								t("addMemberModal.noResults")
							)
						}
					/>
					<Button
						type="primary"
						loading={addMemberLoading}
						disabled={!selectedUserId}
						onClick={handleAddMember}
						block
					>
						{t("addMemberModal.submitButton")}
					</Button>
				</Space>
			</Modal>
		</div>
	);
}
