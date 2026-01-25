import { Card, Typography, Button } from "antd";
import { SafetyOutlined, LogoutOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { Link } from "react-router-dom";
import { useState } from "react";
import { InviteUserModal } from "./UserManagement/InviteUserModal";

const { Title, Text } = Typography;

export function DashboardPage() {
	const { t } = useTranslation();
	const { logout, loading } = useAuth();
	const [inviteModalVisible, setInviteModalVisible] = useState(false);

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

			<Card
				hoverable
				style={{ width: 400, cursor: "pointer", textAlign: "center" }}
				onClick={() => setInviteModalVisible(true)}
			>
				<SafetyOutlined
					style={{ fontSize: 48, color: "#52c41a", marginBottom: 16 }}
				/>
				<Title level={4} style={{ marginBottom: 8 }}>
					Invite User
				</Title>
				<Text type="secondary">
					Invite a new administrator to the platform.
				</Text>
			</Card>

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
