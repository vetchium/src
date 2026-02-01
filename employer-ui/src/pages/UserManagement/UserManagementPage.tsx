import {
	ArrowLeftOutlined,
	PlusOutlined,
	SearchOutlined,
	UserOutlined,
} from "@ant-design/icons";
import {
	App,
	Button,
	Card,
	Empty,
	Input,
	Space,
	Spin,
	Table,
	Tabs,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	FilterOrgUsersRequest,
	FilterOrgUsersResponse,
	OrgUser,
} from "vetchium-specs/org/org-users";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { UserDetailDrawer } from "./UserDetailDrawer";
import { DisableUserModal } from "./DisableUserModal";
import { EnableUserModal } from "./EnableUserModal";

const { Title } = Typography;

type UserStatus = "all" | "active" | "pending" | "disabled";

export function UserManagementPage() {
	const { t } = useTranslation("userManagement");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const { data: myInfo } = useMyInfo(sessionToken);

	const [users, setUsers] = useState<OrgUser[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [statusFilter, setStatusFilter] = useState<UserStatus>("all");

	const [selectedUser, setSelectedUser] = useState<OrgUser | null>(null);
	const [drawerVisible, setDrawerVisible] = useState(false);

	const [disableModalVisible, setDisableModalVisible] = useState(false);
	const [userToDisable, setUserToDisable] = useState<string | null>(null);

	const [enableModalVisible, setEnableModalVisible] = useState(false);
	const [userToEnable, setUserToEnable] = useState<string | null>(null);

	// Permission logic for Org portal: is_admin OR has specific role
	const canInviteUsers =
		myInfo?.is_admin || myInfo?.roles.includes("employer:invite_users") || false;
	const canManageUsers =
		myInfo?.is_admin || myInfo?.roles.includes("employer:manage_users") || false;

	const fetchUsers = useCallback(
		async (
			cursor: string | null = null,
			query: string = searchQuery,
			status: UserStatus = statusFilter
		) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const requestBody: FilterOrgUsersRequest = {
					limit: 50,
				};

				if (cursor) requestBody.cursor = cursor;
				if (query) {
					requestBody.filter_email = query;
					requestBody.filter_name = query;
				}
				if (status !== "all") {
					requestBody.filter_status = status;
				}

				const response = await fetch(`${apiBaseUrl}/employer/filter-users`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(requestBody),
				});

				if (response.status === 401) {
					message.error(t("errors.unauthorized"));
					return;
				}

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data: FilterOrgUsersResponse = await response.json();

				if (cursor === null) {
					setUsers(data.items);
				} else {
					setUsers((prev) => [...prev, ...data.items]);
				}

				setNextCursor(data.next_cursor);
				setHasMore(!!data.next_cursor);
			} catch (err) {
				console.error("Failed to fetch users:", err);
				message.error(t("errors.fetchFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, searchQuery, statusFilter, t, message]
	);

	useEffect(() => {
		fetchUsers(null, "");
	}, [fetchUsers]);

	const handleSearch = (value: string) => {
		setSearchQuery(value);
		setNextCursor(null);
		fetchUsers(null, value);
	};

	const handleLoadMore = () => {
		if (nextCursor && hasMore && !loading) {
			fetchUsers(nextCursor, searchQuery);
		}
	};

	const handleStatusChange = (status: UserStatus) => {
		setStatusFilter(status);
		setSearchQuery("");
		setNextCursor(null);
		fetchUsers(null, "", status);
	};

	const handleViewDetails = (user: OrgUser) => {
		setSelectedUser(user);
		setDrawerVisible(true);
	};

	const handleUserUpdated = () => {
		// Refresh the user list
		fetchUsers(null, searchQuery, statusFilter);
	};

	const handleDisableUser = (email: string) => {
		setUserToDisable(email);
		setDisableModalVisible(true);
	};

	const handleEnableUser = (email: string) => {
		setUserToEnable(email);
		setEnableModalVisible(true);
	};

	const handleDisableSuccess = () => {
		setDisableModalVisible(false);
		setUserToDisable(null);
		fetchUsers(null, searchQuery, statusFilter);
	};

	const handleEnableSuccess = () => {
		setEnableModalVisible(false);
		setUserToEnable(null);
		fetchUsers(null, searchQuery, statusFilter);
	};

	const columns = [
		{
			title: t("table.email"),
			dataIndex: "email_address",
			key: "email_address",
		},
		{
			title: t("table.name"),
			dataIndex: "name",
			key: "name",
		},
		{
			title: t("table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => {
				const colorMap: Record<string, string> = {
					active: "green",
					pending: "orange",
					disabled: "red",
				};
				return <Tag color={colorMap[status] || "default"}>{status}</Tag>;
			},
		},
		{
			title: t("table.roles"),
			dataIndex: "roles",
			key: "roles",
			render: (roles: string[]) => (
				<>
					{roles.length === 0 ? (
						<span style={{ color: "#999" }}>{t("table.noRoles")}</span>
					) : (
						<Space size={[0, 4]} wrap>
							{roles.map((role) => (
								<Tag key={role} color="blue">
									{role}
								</Tag>
							))}
						</Space>
					)}
				</>
			),
		},
		{
			title: t("table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (date: string) => formatDateTime(date),
		},
		{
			title: t("table.actions"),
			key: "actions",
			render: (_: unknown, record: OrgUser) => (
				<Space>
					<Button
						type="link"
						size="small"
						icon={<UserOutlined />}
						onClick={() => handleViewDetails(record)}
					>
						{t("table.viewDetails")}
					</Button>
					{canManageUsers && (
						<>
							{record.status === "active" ? (
								<Button
									danger
									size="small"
									onClick={() => handleDisableUser(record.email_address)}
								>
									{t("table.disable")}
								</Button>
							) : record.status === "disabled" ? (
								<Button
									type="primary"
									size="small"
									onClick={() => handleEnableUser(record.email_address)}
								>
									{t("table.enable")}
								</Button>
							) : null}
						</>
					)}
				</Space>
			),
		},
	];

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 24,
				width: "100%",
				maxWidth: 1400,
				margin: "0 auto",
			}}
		>
			<Card style={{ width: "100%", textAlign: "center" }}>
				<Title level={3}>{t("pageTitle")}</Title>
			</Card>

			<Card style={{ width: "100%" }}>
				<Space orientation="vertical" size="large" style={{ width: "100%" }}>
					<Space style={{ justifyContent: "space-between", width: "100%" }}>
						<Link to="/">
							<Button icon={<ArrowLeftOutlined />}>
								{t("common:actions.back")}
							</Button>
						</Link>
						{canInviteUsers && (
							<Button type="primary" icon={<PlusOutlined />}>
								{t("inviteUser")}
							</Button>
						)}
					</Space>

					<Tabs
						activeKey={statusFilter}
						onChange={(key) => handleStatusChange(key as UserStatus)}
						items={[
							{ key: "all", label: t("status.all") },
							{ key: "active", label: t("status.active") },
							{ key: "pending", label: t("status.pending") },
							{ key: "disabled", label: t("status.disabled") },
						]}
					/>

					<Input
						prefix={<SearchOutlined />}
						placeholder={t("searchPlaceholder")}
						value={searchQuery}
						onChange={(e) => handleSearch(e.target.value)}
						allowClear
					/>

					<Spin spinning={loading}>
						<Table
							dataSource={users}
							columns={columns}
							rowKey="email_address"
							pagination={false}
							locale={{
								emptyText: <Empty description={t("common:table.empty")} />,
							}}
						/>
						{hasMore && !loading && (
							<div style={{ textAlign: "center", marginTop: 16 }}>
								<Button onClick={handleLoadMore}>{t("table.loadMore")}</Button>
							</div>
						)}
					</Spin>
				</Space>
			</Card>

			<UserDetailDrawer
				user={selectedUser}
				visible={drawerVisible}
				onClose={() => {
					setDrawerVisible(false);
					setSelectedUser(null);
				}}
				onUserUpdated={handleUserUpdated}
			/>

			<DisableUserModal
				email={userToDisable}
				visible={disableModalVisible}
				onCancel={() => {
					setDisableModalVisible(false);
					setUserToDisable(null);
				}}
				onSuccess={handleDisableSuccess}
			/>

			<EnableUserModal
				email={userToEnable}
				visible={enableModalVisible}
				onCancel={() => {
					setEnableModalVisible(false);
					setUserToEnable(null);
				}}
				onSuccess={handleEnableSuccess}
			/>
		</div>
	);
}
