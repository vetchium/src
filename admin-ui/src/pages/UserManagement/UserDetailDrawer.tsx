import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Descriptions,
	Drawer,
	Select,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AdminUser } from "vetchium-specs/admin/admin-users";
import type {
	AssignRoleRequest,
	RemoveRoleRequest,
} from "vetchium-specs/common/roles";
import { VALID_ROLE_NAMES } from "vetchium-specs/common/roles";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;

interface UserDetailDrawerProps {
	user: AdminUser | null;
	visible: boolean;
	onClose: () => void;
	onUserUpdated: () => void;
}

export function UserDetailDrawer({
	user,
	visible,
	onClose,
	onUserUpdated,
}: UserDetailDrawerProps) {
	const { t } = useTranslation("userManagement");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const { data: myInfo } = useMyInfo(sessionToken);

	const [assigningRole, setAssigningRole] = useState(false);
	const [removingRole, setRemovingRole] = useState<string | null>(null);
	const [selectedRole, setSelectedRole] = useState<string | undefined>(
		undefined
	);

	const canManageUsers = myInfo?.roles.includes("admin:manage_users") || false;

	// Filter roles to admin:* only
	const ADMIN_ROLES = VALID_ROLE_NAMES.filter((r) => r.startsWith("admin:"));

	// Get roles that can be assigned (not already assigned)
	const availableRoles = ADMIN_ROLES.filter(
		(role) => !user?.roles.includes(role)
	);

	const handleAssignRole = async () => {
		if (!selectedRole || !user) return;

		setAssigningRole(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: AssignRoleRequest = {
				target_user_id: user.email_address,
				role_name: selectedRole,
			};

			const response = await fetch(`${apiBaseUrl}/admin/assign-role`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 400) {
				const errors: unknown = await response.json();
				if (Array.isArray(errors)) {
					const errorMsg = errors
						.map(
							(e: { field: string; message: string }) =>
								`${e.field}: ${e.message}`
						)
						.join(", ");
					message.error(errorMsg);
				} else {
					message.error(t("errors.serverError"));
				}
				return;
			}

			if (response.status === 401) {
				message.error(t("errors.unauthorized"));
				return;
			}

			if (response.status === 403) {
				message.error(t("errors.forbidden"));
				return;
			}

			if (response.status === 404) {
				message.error(t("errors.userNotFound"));
				return;
			}

			if (response.status === 409) {
				message.error(t("errors.roleAlreadyAssigned"));
				return;
			}

			if (response.status === 200) {
				message.success(t("success.roleAssigned"));
				setSelectedRole(undefined);
				onUserUpdated();
			}
		} catch (err) {
			console.error("Failed to assign role:", err);
			message.error(t("errors.assignRoleFailed"));
		} finally {
			setAssigningRole(false);
		}
	};

	const handleRemoveRole = async (roleName: string) => {
		if (!user) return;

		// Prevent removing own manage_users role
		if (
			myInfo?.email_address === user.email_address &&
			roleName === "admin:manage_users"
		) {
			message.error(t("errors.cannotRemoveOwnRole"));
			return;
		}

		setRemovingRole(roleName);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: RemoveRoleRequest = {
				target_user_id: user.email_address,
				role_name: roleName,
			};

			const response = await fetch(`${apiBaseUrl}/admin/remove-role`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 400) {
				const errors: unknown = await response.json();
				if (Array.isArray(errors)) {
					const errorMsg = errors
						.map(
							(e: { field: string; message: string }) =>
								`${e.field}: ${e.message}`
						)
						.join(", ");
					message.error(errorMsg);
				} else {
					message.error(t("errors.serverError"));
				}
				return;
			}

			if (response.status === 401) {
				message.error(t("errors.unauthorized"));
				return;
			}

			if (response.status === 403) {
				message.error(t("errors.forbidden"));
				return;
			}

			if (response.status === 404) {
				message.error(t("errors.userNotFound"));
				return;
			}

			if (response.status === 409) {
				message.error(t("errors.roleNotAssigned"));
				return;
			}

			if (response.status === 200) {
				message.success(t("success.roleRemoved"));
				onUserUpdated();
			}
		} catch (err) {
			console.error("Failed to remove role:", err);
			message.error(t("errors.removeRoleFailed"));
		} finally {
			setRemovingRole(null);
		}
	};

	if (!user) return null;

	return (
		<Drawer
			title={t("drawer.title")}
			open={visible}
			onClose={onClose}
			size="large"
		>
			<Space orientation="vertical" size="large" style={{ width: "100%" }}>
				<div>
					<Title level={5}>{t("drawer.userInfo")}</Title>
					<Descriptions bordered column={1}>
						<Descriptions.Item label={t("table.email")}>
							{user.email_address}
						</Descriptions.Item>
						<Descriptions.Item label={t("table.name")}>
							{user.name}
						</Descriptions.Item>
						<Descriptions.Item label={t("table.status")}>
							<Tag
								color={
									user.status === "active"
										? "green"
										: user.status === "pending"
											? "orange"
											: "red"
								}
							>
								{user.status}
							</Tag>
						</Descriptions.Item>
						<Descriptions.Item label={t("table.createdAt")}>
							{formatDateTime(user.created_at)}
						</Descriptions.Item>
					</Descriptions>
				</div>

				{canManageUsers && (
					<div>
						<Title level={5}>{t("drawer.roleManagement")}</Title>

						<Space
							orientation="vertical"
							size="middle"
							style={{ width: "100%" }}
						>
							<div>
								<Title level={5}>{t("drawer.currentRoles")}</Title>
								{user.roles.length === 0 ? (
									<div style={{ color: "#999", fontStyle: "italic" }}>
										{t("drawer.noRolesAssigned")}
									</div>
								) : (
									<Space size={[8, 8]} wrap>
										{user.roles.map((role) => (
											<Tag
												key={role}
												color="blue"
												closable={removingRole !== role}
												onClose={() => handleRemoveRole(role)}
												closeIcon={
													removingRole === role ? (
														<Spin size="small" />
													) : (
														<CloseOutlined />
													)
												}
											>
												{role}
											</Tag>
										))}
									</Space>
								)}
							</div>

							{availableRoles.length > 0 && (
								<div>
									<Title level={5}>{t("drawer.addRole")}</Title>
									<Space>
										<Select
											style={{ width: 300 }}
											placeholder={t("drawer.selectRole")}
											value={selectedRole}
											onChange={setSelectedRole}
											options={availableRoles.map((role) => ({
												label: role,
												value: role,
											}))}
										/>
										<Button
											type="primary"
											icon={<PlusOutlined />}
											onClick={handleAssignRole}
											loading={assigningRole}
											disabled={!selectedRole}
										>
											{t("drawer.assignRole")}
										</Button>
									</Space>
								</div>
							)}
						</Space>
					</div>
				)}
			</Space>
		</Drawer>
	);
}
