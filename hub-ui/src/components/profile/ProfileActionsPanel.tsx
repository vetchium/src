import { Button, Dropdown, Popconfirm, Spin, Tag, message } from "antd";
import { EllipsisOutlined } from "@ant-design/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import type { ConnectionState } from "vetchium-specs/hub/connections";

interface ProfileActionsPanelProps {
	handle: string;
	displayName: string;
	connectionState: ConnectionState;
	onStateChange: (newState: ConnectionState) => void;
}

export function ProfileActionsPanel({
	handle,
	displayName,
	connectionState,
	onStateChange,
}: ProfileActionsPanelProps) {
	const { t: tProfile } = useTranslation("profile");
	const { t: tConnections } = useTranslation("connections");
	const { sessionToken } = useAuth();
	const [actionInProgress, setActionInProgress] = useState(false);

	const callApi = useCallback(
		async (endpoint: string, method: string = "POST") => {
			setActionInProgress(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}${endpoint}`, {
					method,
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ handle }),
				});
				return response;
			} finally {
				setActionInProgress(false);
			}
		},
		[handle, sessionToken]
	);

	const handleSendRequest = useCallback(async () => {
		const response = await callApi("/hub/connections/send-request");
		if (response.status === 201) {
			onStateChange("request_sent");
			message.success(tConnections("widget.requestSent"));
		} else {
			message.error(tConnections("widget.requestFailed"));
		}
	}, [callApi, onStateChange, tConnections]);

	const handleWithdraw = useCallback(async () => {
		const response = await callApi("/hub/connections/withdraw-request");
		if (response.status === 204) {
			onStateChange("not_connected");
			message.success(tConnections("widget.requestWithdrawn"));
		} else {
			message.error(tConnections("widget.withdrawFailed"));
		}
	}, [callApi, onStateChange, tConnections]);

	const handleAccept = useCallback(async () => {
		const response = await callApi("/hub/connections/accept-request");
		if (response.status === 200) {
			onStateChange("connected");
			message.success(tConnections("widget.requestAccepted"));
		} else {
			message.error(tConnections("widget.acceptFailed"));
		}
	}, [callApi, onStateChange, tConnections]);

	const handleReject = useCallback(async () => {
		const response = await callApi("/hub/connections/reject-request");
		if (response.status === 204) {
			onStateChange("not_connected");
			message.success(tConnections("widget.requestRejected"));
		} else {
			message.error(tConnections("widget.rejectFailed"));
		}
	}, [callApi, onStateChange, tConnections]);

	const handleDisconnect = useCallback(async () => {
		const response = await callApi("/hub/connections/disconnect");
		if (response.status === 204) {
			onStateChange("i_disconnected");
			message.success(tConnections("widget.disconnected"));
		} else {
			message.error(tConnections("widget.disconnectFailed"));
		}
	}, [callApi, onStateChange, tConnections]);

	const handleBlock = useCallback(async () => {
		const response = await callApi("/hub/connections/block");
		if (response.status === 201) {
			onStateChange("i_blocked_them");
			message.success(tConnections("widget.userBlocked"));
		} else {
			message.error(tConnections("widget.blockFailed"));
		}
	}, [callApi, onStateChange, tConnections]);

	const handleUnblock = useCallback(async () => {
		const response = await callApi("/hub/connections/unblock");
		if (response.status === 204) {
			onStateChange("not_connected");
			message.success(tConnections("widget.userUnblocked"));
		} else {
			message.error(tConnections("widget.unblockFailed"));
		}
	}, [callApi, onStateChange, tConnections]);

	const renderMoreMenu = (
		items: Array<{ key: string; label: React.ReactNode }>
	) => {
		return (
			<Dropdown menu={{ items }} trigger={["click"]}>
				<Button
					type="text"
					icon={<EllipsisOutlined />}
					loading={actionInProgress}
				/>
			</Dropdown>
		);
	};

	if (connectionState === "not_connected") {
		return (
			<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<Spin spinning={actionInProgress}>
					<Button
						type="primary"
						onClick={handleSendRequest}
						loading={actionInProgress}
					>
						{tConnections("widget.connect")}
					</Button>
				</Spin>
				{renderMoreMenu([
					{
						key: "block",
						label: (
							<Popconfirm
								title={tConnections("widget.blockConfirm.title")}
								description={tConnections("widget.blockConfirm.description")}
								onConfirm={(e) => {
									e?.stopPropagation();
									handleBlock();
								}}
								okText={tConnections("widget.blockConfirm.ok")}
								cancelText={tConnections("widget.blockConfirm.cancel")}
							>
								<div onClick={(e) => e.stopPropagation()}>
									{tConnections("widget.block")}
								</div>
							</Popconfirm>
						),
					},
				])}
			</div>
		);
	}

	if (connectionState === "ineligible") {
		return null;
	}

	if (connectionState === "request_sent") {
		return (
			<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<Spin spinning={actionInProgress}>
					<Button
						type="default"
						onClick={handleWithdraw}
						loading={actionInProgress}
					>
						{tConnections("widget.withdraw")}
					</Button>
				</Spin>
				<div style={{ color: "#999", fontSize: "14px" }}>
					{tProfile("publicProfile.requestPending")}
				</div>
			</div>
		);
	}

	if (connectionState === "request_received") {
		return (
			<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<Spin spinning={actionInProgress}>
					<div style={{ display: "flex", gap: 8 }}>
						<Button
							type="primary"
							onClick={handleAccept}
							loading={actionInProgress}
						>
							{tConnections("widget.accept")}
						</Button>
						<Button onClick={handleReject} loading={actionInProgress}>
							{tConnections("widget.reject")}
						</Button>
					</div>
				</Spin>
				<div style={{ color: "#999", fontSize: "14px" }}>
					{tProfile("publicProfile.requestReceived", { displayName })}
				</div>
			</div>
		);
	}

	if (connectionState === "connected") {
		return (
			<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<Tag>{tProfile("publicProfile.connectedBadge")}</Tag>
				{renderMoreMenu([
					{
						key: "disconnect",
						label: (
							<Popconfirm
								title={tConnections("widget.disconnectConfirm.title")}
								description={tConnections(
									"widget.disconnectConfirm.description"
								)}
								onConfirm={(e) => {
									e?.stopPropagation();
									handleDisconnect();
								}}
								okText={tConnections("widget.disconnectConfirm.ok")}
								cancelText={tConnections("widget.disconnectConfirm.cancel")}
							>
								<div onClick={(e) => e.stopPropagation()}>
									{tConnections("widget.disconnect")}
								</div>
							</Popconfirm>
						),
					},
					{
						key: "block",
						label: (
							<Popconfirm
								title={tConnections("widget.blockConfirm.title")}
								description={tConnections("widget.blockConfirm.description")}
								onConfirm={(e) => {
									e?.stopPropagation();
									handleBlock();
								}}
								okText={tConnections("widget.blockConfirm.ok")}
								cancelText={tConnections("widget.blockConfirm.cancel")}
							>
								<div onClick={(e) => e.stopPropagation()}>
									{tConnections("widget.block")}
								</div>
							</Popconfirm>
						),
					},
				])}
			</div>
		);
	}

	if (connectionState === "i_rejected_their_request") {
		return (
			<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<Spin spinning={actionInProgress}>
					<Button
						type="primary"
						onClick={handleSendRequest}
						loading={actionInProgress}
					>
						{tConnections("widget.connect")}
					</Button>
				</Spin>
				{renderMoreMenu([
					{
						key: "block",
						label: (
							<Popconfirm
								title={tConnections("widget.blockConfirm.title")}
								description={tConnections("widget.blockConfirm.description")}
								onConfirm={(e) => {
									e?.stopPropagation();
									handleBlock();
								}}
								okText={tConnections("widget.blockConfirm.ok")}
								cancelText={tConnections("widget.blockConfirm.cancel")}
							>
								<div onClick={(e) => e.stopPropagation()}>
									{tConnections("widget.block")}
								</div>
							</Popconfirm>
						),
					},
				])}
			</div>
		);
	}

	if (connectionState === "they_rejected_my_request") {
		return renderMoreMenu([
			{
				key: "block",
				label: (
					<Popconfirm
						title={tConnections("widget.blockConfirm.title")}
						description={tConnections("widget.blockConfirm.description")}
						onConfirm={(e) => {
							e?.stopPropagation();
							handleBlock();
						}}
						okText={tConnections("widget.blockConfirm.ok")}
						cancelText={tConnections("widget.blockConfirm.cancel")}
					>
						<div onClick={(e) => e.stopPropagation()}>
							{tConnections("widget.block")}
						</div>
					</Popconfirm>
				),
			},
		]);
	}

	if (connectionState === "i_disconnected") {
		return (
			<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<Spin spinning={actionInProgress}>
					<Button
						type="primary"
						onClick={handleSendRequest}
						loading={actionInProgress}
					>
						{tConnections("widget.connect")}
					</Button>
				</Spin>
				{renderMoreMenu([
					{
						key: "block",
						label: (
							<Popconfirm
								title={tConnections("widget.blockConfirm.title")}
								description={tConnections("widget.blockConfirm.description")}
								onConfirm={(e) => {
									e?.stopPropagation();
									handleBlock();
								}}
								okText={tConnections("widget.blockConfirm.ok")}
								cancelText={tConnections("widget.blockConfirm.cancel")}
							>
								<div onClick={(e) => e.stopPropagation()}>
									{tConnections("widget.block")}
								</div>
							</Popconfirm>
						),
					},
				])}
			</div>
		);
	}

	if (connectionState === "they_disconnected") {
		return renderMoreMenu([
			{
				key: "block",
				label: (
					<Popconfirm
						title={tConnections("widget.blockConfirm.title")}
						description={tConnections("widget.blockConfirm.description")}
						onConfirm={(e) => {
							e?.stopPropagation();
							handleBlock();
						}}
						okText={tConnections("widget.blockConfirm.ok")}
						cancelText={tConnections("widget.blockConfirm.cancel")}
					>
						<div onClick={(e) => e.stopPropagation()}>
							{tConnections("widget.block")}
						</div>
					</Popconfirm>
				),
			},
		]);
	}

	if (connectionState === "i_blocked_them") {
		return (
			<Spin spinning={actionInProgress}>
				<Button
					type="default"
					onClick={handleUnblock}
					loading={actionInProgress}
				>
					{tConnections("widget.unblock")}
				</Button>
			</Spin>
		);
	}

	if (connectionState === "blocked_by_them") {
		return (
			<div style={{ color: "#999" }}>
				{tProfile("publicProfile.youCannotInteract")}
			</div>
		);
	}

	return null;
}
