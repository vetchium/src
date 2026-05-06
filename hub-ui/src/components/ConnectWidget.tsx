import { Button, Popconfirm, Spin, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";
import type { ConnectionState, GetStatusResponse } from "vetchium-specs/hub/connections";

interface ConnectWidgetProps {
	handle: string;
	onConnectionStateChange?: (state: ConnectionState) => void;
}

export function ConnectWidget({ handle, onConnectionStateChange }: ConnectWidgetProps) {
	const { t } = useTranslation("connections");
	const { sessionToken } = useAuth();

	const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionInProgress, setActionInProgress] = useState(false);

	// Fetch connection status
	const fetchStatus = useCallback(async () => {
		if (!sessionToken || !handle) {
			setLoading(false);
			return;
		}
		try {
			setLoading(true);
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/connections/get-status`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (response.status === 200) {
				const data: GetStatusResponse = await response.json();
				setConnectionState(data.connection_state);
				onConnectionStateChange?.(data.connection_state);
			} else if (response.status === 404) {
				// Handle not found
				setConnectionState(null);
			}
		} catch (err) {
			console.error("Failed to fetch connection status:", err);
		} finally {
			setLoading(false);
		}
	}, [sessionToken, handle, onConnectionStateChange]);

	useEffect(() => {
		fetchStatus();
	}, [fetchStatus]);

	// Action handlers
	const handleSendRequest = useCallback(async () => {
		setActionInProgress(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/connections/send-request`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (response.status === 201) {
				setConnectionState("request_sent");
				message.success(t("widget.requestSent"));
				onConnectionStateChange?.("request_sent");
			} else if (response.status === 400) {
				message.error(t("widget.invalidHandle"));
			} else if (response.status === 404) {
				message.error(t("widget.handleNotFound"));
			} else if (response.status === 452) {
				message.error(t("widget.cannotConnectToSelf"));
			} else if (response.status === 453) {
				message.error(t("widget.ineligible"));
			} else if (response.status === 457) {
				message.error(t("widget.youBlockedThem"));
			} else if (response.status === 460) {
				message.error(t("widget.theyBlockedYou"));
			} else if (response.status === 454) {
				message.error(t("widget.requestAlreadyExists"));
			} else {
				message.error(t("widget.requestFailed"));
			}
		} catch (err) {
			console.error("Failed to send request:", err);
			message.error(t("widget.requestFailed"));
		} finally {
			setActionInProgress(false);
		}
	}, [handle, sessionToken, onConnectionStateChange, t]);

	const handleWithdraw = useCallback(async () => {
		setActionInProgress(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/connections/withdraw-request`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (response.status === 204) {
				setConnectionState("not_connected");
				message.success(t("widget.requestWithdrawn"));
				onConnectionStateChange?.("not_connected");
			} else if (response.status === 404) {
				message.error(t("widget.noPendingRequest"));
			} else {
				message.error(t("widget.withdrawFailed"));
			}
		} catch (err) {
			console.error("Failed to withdraw request:", err);
			message.error(t("widget.withdrawFailed"));
		} finally {
			setActionInProgress(false);
		}
	}, [handle, sessionToken, onConnectionStateChange, t]);

	const handleAccept = useCallback(async () => {
		setActionInProgress(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/connections/accept-request`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (response.status === 200) {
				setConnectionState("connected");
				message.success(t("widget.requestAccepted"));
				onConnectionStateChange?.("connected");
			} else if (response.status === 404) {
				message.error(t("widget.noPendingRequest"));
			} else {
				message.error(t("widget.acceptFailed"));
			}
		} catch (err) {
			console.error("Failed to accept request:", err);
			message.error(t("widget.acceptFailed"));
		} finally {
			setActionInProgress(false);
		}
	}, [handle, sessionToken, onConnectionStateChange, t]);

	const handleReject = useCallback(async () => {
		setActionInProgress(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/connections/reject-request`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (response.status === 204) {
				setConnectionState("not_connected");
				message.success(t("widget.requestRejected"));
				onConnectionStateChange?.("not_connected");
			} else if (response.status === 404) {
				message.error(t("widget.noPendingRequest"));
			} else {
				message.error(t("widget.rejectFailed"));
			}
		} catch (err) {
			console.error("Failed to reject request:", err);
			message.error(t("widget.rejectFailed"));
		} finally {
			setActionInProgress(false);
		}
	}, [handle, sessionToken, onConnectionStateChange, t]);

	const handleDisconnect = useCallback(async () => {
		setActionInProgress(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/connections/disconnect`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (response.status === 204) {
				setConnectionState("i_disconnected");
				message.success(t("widget.disconnected"));
				onConnectionStateChange?.("i_disconnected");
			} else if (response.status === 404) {
				message.error(t("widget.noConnection"));
			} else {
				message.error(t("widget.disconnectFailed"));
			}
		} catch (err) {
			console.error("Failed to disconnect:", err);
			message.error(t("widget.disconnectFailed"));
		} finally {
			setActionInProgress(false);
		}
	}, [handle, sessionToken, onConnectionStateChange, t]);

	const handleBlock = useCallback(async () => {
		setActionInProgress(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/connections/block`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (response.status === 201) {
				setConnectionState("i_blocked_them");
				message.success(t("widget.userBlocked"));
				onConnectionStateChange?.("i_blocked_them");
			} else if (response.status === 404) {
				message.error(t("widget.handleNotFound"));
			} else if (response.status === 452) {
				message.error(t("widget.cannotBlockSelf"));
			} else if (response.status === 458) {
				message.error(t("widget.alreadyBlocked"));
			} else {
				message.error(t("widget.blockFailed"));
			}
		} catch (err) {
			console.error("Failed to block user:", err);
			message.error(t("widget.blockFailed"));
		} finally {
			setActionInProgress(false);
		}
	}, [handle, sessionToken, onConnectionStateChange, t]);

	const handleUnblock = useCallback(async () => {
		setActionInProgress(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/connections/unblock`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (response.status === 204) {
				// After unblocking, we need to refetch the status to get the true state
				await fetchStatus();
				message.success(t("widget.userUnblocked"));
			} else if (response.status === 459) {
				message.error(t("widget.notBlocked"));
			} else {
				message.error(t("widget.unblockFailed"));
			}
		} catch (err) {
			console.error("Failed to unblock user:", err);
			message.error(t("widget.unblockFailed"));
		} finally {
			setActionInProgress(false);
		}
	}, [handle, sessionToken, t, fetchStatus]);

	if (loading) {
		return <Spin size="small" />;
	}

	if (!connectionState) {
		return null;
	}

	// Render based on connection state
	switch (connectionState) {
		case "not_connected":
			return (
				<Button
					type="primary"
					onClick={handleSendRequest}
					loading={actionInProgress}
				>
					{t("widget.connect")}
				</Button>
			);

		case "ineligible":
			return null;

		case "request_sent":
			return (
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<span>{t("widget.requestSent")}</span>
					<Button
						type="link"
						onClick={() =>
							new Promise<void>((resolve) => {
								handleWithdraw().finally(() => resolve());
							})
						}
						loading={actionInProgress}
					>
						{t("widget.withdraw")}
					</Button>
				</div>
			);

		case "request_received":
			return (
				<div style={{ display: "flex", gap: 8 }}>
					<Button
						type="primary"
						onClick={handleAccept}
						loading={actionInProgress}
					>
						{t("widget.accept")}
					</Button>
					<Button onClick={handleReject} loading={actionInProgress}>
						{t("widget.reject")}
					</Button>
				</div>
			);

		case "connected":
			return (
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<span>✓ {t("widget.connected")}</span>
					<Popconfirm
						title={t("widget.disconnectConfirm.title")}
						description={t("widget.disconnectConfirm.description")}
						onConfirm={() =>
							new Promise<void>((resolve) => {
								handleDisconnect().finally(() => resolve());
							})
						}
						okText={t("widget.disconnectConfirm.ok")}
						cancelText={t("widget.disconnectConfirm.cancel")}
					>
						<Button type="link" loading={actionInProgress}>
							{t("widget.disconnect")}
						</Button>
					</Popconfirm>
					<Popconfirm
						title={t("widget.blockConfirm.title")}
						description={t("widget.blockConfirm.description")}
						onConfirm={() =>
							new Promise<void>((resolve) => {
								handleBlock().finally(() => resolve());
							})
						}
						okText={t("widget.blockConfirm.ok")}
						cancelText={t("widget.blockConfirm.cancel")}
					>
						<Button type="link" loading={actionInProgress}>
							{t("widget.block")}
						</Button>
					</Popconfirm>
				</div>
			);

		case "i_rejected_their_request":
			return (
				<div style={{ display: "flex", gap: 8 }}>
					<Button
						type="primary"
						onClick={handleSendRequest}
						loading={actionInProgress}
					>
						{t("widget.connect")}
					</Button>
					<Popconfirm
						title={t("widget.blockConfirm.title")}
						description={t("widget.blockConfirm.description")}
						onConfirm={() =>
							new Promise<void>((resolve) => {
								handleBlock().finally(() => resolve());
							})
						}
						okText={t("widget.blockConfirm.ok")}
						cancelText={t("widget.blockConfirm.cancel")}
					>
						<Button type="link" loading={actionInProgress}>
							{t("widget.block")}
						</Button>
					</Popconfirm>
				</div>
			);

		case "they_rejected_my_request":
			return (
				<Popconfirm
					title={t("widget.blockConfirm.title")}
					description={t("widget.blockConfirm.description")}
					onConfirm={() =>
						new Promise<void>((resolve) => {
							handleBlock().finally(() => resolve());
						})
					}
					okText={t("widget.blockConfirm.ok")}
					cancelText={t("widget.blockConfirm.cancel")}
				>
					<Button type="link" loading={actionInProgress}>
						{t("widget.block")}
					</Button>
				</Popconfirm>
			);

		case "i_disconnected":
			return (
				<div style={{ display: "flex", gap: 8 }}>
					<Button
						type="primary"
						onClick={handleSendRequest}
						loading={actionInProgress}
					>
						{t("widget.connect")}
					</Button>
					<Popconfirm
						title={t("widget.blockConfirm.title")}
						description={t("widget.blockConfirm.description")}
						onConfirm={() =>
							new Promise<void>((resolve) => {
								handleBlock().finally(() => resolve());
							})
						}
						okText={t("widget.blockConfirm.ok")}
						cancelText={t("widget.blockConfirm.cancel")}
					>
						<Button type="link" loading={actionInProgress}>
							{t("widget.block")}
						</Button>
					</Popconfirm>
				</div>
			);

		case "they_disconnected":
			return (
				<Popconfirm
					title={t("widget.blockConfirm.title")}
					description={t("widget.blockConfirm.description")}
					onConfirm={() =>
						new Promise<void>((resolve) => {
							handleBlock().finally(() => resolve());
						})
					}
					okText={t("widget.blockConfirm.ok")}
					cancelText={t("widget.blockConfirm.cancel")}
				>
					<Button type="link" loading={actionInProgress}>
						{t("widget.block")}
					</Button>
				</Popconfirm>
			);

		case "i_blocked_them":
			return (
				<Button
					type="primary"
					onClick={handleUnblock}
					loading={actionInProgress}
				>
					{t("widget.unblock")}
				</Button>
			);

		case "blocked_by_them":
			return (
				<span style={{ color: "#999" }}>
					🚫 {t("widget.blockedByThem")}
				</span>
			);

		default:
			return null;
	}
}
