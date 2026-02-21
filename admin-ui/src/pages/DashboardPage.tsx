import { Card, Skeleton, Typography, Button } from "antd";
import {
	SafetyOutlined,
	LogoutOutlined,
	TeamOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { useMyInfo } from "../hooks/useMyInfo";
import { Link } from "react-router-dom";
import { useState } from "react";
import { InviteUserModal } from "./UserManagement/InviteUserModal";

const { Title, Text } = Typography;

export function DashboardPage() {
	const { t } = useTranslation();
	const { logout, loading, sessionToken } = useAuth();
	const { data: myInfo, loading: myInfoLoading } = useMyInfo(sessionToken);
	const [inviteModalVisible, setInviteModalVisible] = useState(false);

	const canManageDomains =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:manage_domains") ||
		false;

	const canManageUsers =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:manage_users") ||
		false;

	const canInviteUsers =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:invite_users") ||
		false;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 24,
				maxWidth: 800,
				width: "100%",
			}}
		>
			{myInfoLoading ? (
				<>
					<Card style={{ width: 400 }}>
						<Skeleton active />
					</Card>
					<Card style={{ width: 400 }}>
						<Skeleton active />
					</Card>
				</>
			) : (
				<>
					{canManageDomains && (
						<Link to="/approved-domains" style={{ textDecoration: "none" }}>
							<Card
								hoverable
								style={{ width: 400, cursor: "pointer", textAlign: "center" }}
							>
								<SafetyOutlined
									style={{ fontSize: 48, color: "#1890ff", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("approvedDomains:dashboardTitle")}
								</Title>
								<Text type="secondary">
									{t("approvedDomains:dashboardDescription")}
								</Text>
							</Card>
						</Link>
					)}

					{canManageUsers && (
						<Link to="/user-management" style={{ textDecoration: "none" }}>
							<Card
								hoverable
								style={{ width: 400, cursor: "pointer", textAlign: "center" }}
							>
								<TeamOutlined
									style={{ fontSize: 48, color: "#722ed1", marginBottom: 16 }}
								/>
								<Title level={4} style={{ marginBottom: 8 }}>
									{t("userManagement:pageTitle")}
								</Title>
								<Text type="secondary">
									{t("userManagement:dashboardDescription")}
								</Text>
							</Card>
						</Link>
					)}

					{canInviteUsers && (
						<Card
							hoverable
							style={{ width: 400, cursor: "pointer", textAlign: "center" }}
							onClick={() => setInviteModalVisible(true)}
						>
							<SafetyOutlined
								style={{ fontSize: 48, color: "#52c41a", marginBottom: 16 }}
							/>
							<Title level={4} style={{ marginBottom: 8 }}>
								{t("userManagement:inviteUser")}
							</Title>
							<Text type="secondary">
								{t("userManagement:inviteUserDescription")}
							</Text>
						</Card>
					)}
				</>
			)}

			<InviteUserModal
				visible={inviteModalVisible}
				onCancel={() => setInviteModalVisible(false)}
				onSuccess={() => setInviteModalVisible(false)}
			/>

			<Card style={{ width: 400, textAlign: "center" }}>
				<Title level={3} style={{ marginBottom: 24 }}>
					{t("dashboard.title")}
				</Title>

				<Button
					type="primary"
					danger
					onClick={logout}
					loading={loading}
					block
					size="large"
					icon={<LogoutOutlined />}
				>
					{t("logout.button")}
				</Button>
			</Card>
		</div>
	);
}
