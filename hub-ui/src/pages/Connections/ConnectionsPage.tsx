import {
	ArrowLeftOutlined,
	TeamOutlined,
	UserOutlined,
} from "@ant-design/icons";
import {
	Avatar,
	Badge,
	Button,
	Input,
	Popconfirm,
	Spin,
	Tabs,
	Typography,
	message,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	BlockedUser,
	Connection,
	ConnectionCounts,
	ListBlockedRequest,
	ListConnectionsRequest,
	ListIncomingRequestsResponse,
	ListOutgoingRequestsResponse,
	PendingRequest,
	SearchConnectionsRequest,
} from "vetchium-specs/hub/connections";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text } = Typography;
const { Search } = Input;

const PAGE_SIZE = 20;

function PersonRow({
	handle,
	displayName,
	shortBio,
	hasPicture,
	secondaryText,
	actions,
	onClick,
}: {
	handle: string;
	displayName: string;
	shortBio?: string;
	hasPicture?: boolean;
	secondaryText?: string;
	actions: React.ReactNode;
	onClick?: () => void;
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 16,
				padding: "14px 0",
				borderBottom: "1px solid #f0f0f0",
			}}
		>
			<div style={{ flexShrink: 0 }}>
				{hasPicture ? (
					<img
						src={`/hub/profile-picture/${handle}`}
						alt={displayName}
						style={{
							width: 52,
							height: 52,
							borderRadius: "50%",
							objectFit: "cover",
						}}
					/>
				) : (
					<Avatar size={52} icon={<UserOutlined />} />
				)}
			</div>
			<div style={{ flex: 1, minWidth: 0 }}>
				<a
					onClick={onClick}
					style={{
						cursor: "pointer",
						fontWeight: 600,
						fontSize: 15,
						display: "block",
					}}
				>
					{displayName}
				</a>
				<Text
					type="secondary"
					style={{ fontFamily: "monospace", fontSize: 12, display: "block" }}
				>
					@{handle}
				</Text>
				{shortBio && (
					<Text
						type="secondary"
						style={{ fontSize: 13, display: "block" }}
						ellipsis
					>
						{shortBio}
					</Text>
				)}
				{secondaryText && (
					<Text type="secondary" style={{ fontSize: 11, display: "block" }}>
						{secondaryText}
					</Text>
				)}
			</div>
			<div style={{ flexShrink: 0 }}>{actions}</div>
		</div>
	);
}

export function ConnectionsPage() {
	const { t, i18n } = useTranslation("connections");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();

	const [counts, setCounts] = useState<ConnectionCounts | null>(null);
	const [activeTab, setActiveTab] = useState("incoming");

	// Connections tab
	const [connections, setConnections] = useState<Connection[]>([]);
	const [connectionsNextKey, setConnectionsNextKey] = useState<
		string | undefined
	>();
	const [connectionsLoading, setConnectionsLoading] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<Connection[] | null>(null);
	const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Incoming tab
	const [incoming, setIncoming] = useState<PendingRequest[]>([]);
	const [incomingNextKey, setIncomingNextKey] = useState<string | undefined>();
	const [incomingLoading, setIncomingLoading] = useState(false);

	// Outgoing tab
	const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
	const [outgoingNextKey, setOutgoingNextKey] = useState<string | undefined>();
	const [outgoingLoading, setOutgoingLoading] = useState(false);

	// Blocked tab
	const [blocked, setBlocked] = useState<BlockedUser[]>([]);
	const [blockedNextKey, setBlockedNextKey] = useState<string | undefined>();
	const [blockedLoading, setBlockedLoading] = useState(false);

	const fetchCounts = useCallback(async () => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/connections/counts`, {
				method: "GET",
				headers: { Authorization: `Bearer ${sessionToken}` },
			});
			if (res.status === 200) {
				setCounts(await res.json());
			}
		} catch {
			// counts are decorative
		}
	}, [sessionToken]);

	const fetchConnections = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setConnectionsLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListConnectionsRequest = {
					limit: PAGE_SIZE,
					pagination_key: paginationKey,
				};
				const res = await fetch(`${apiBaseUrl}/hub/connections/list`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data = await res.json();
					setConnections((prev) =>
						paginationKey ? [...prev, ...data.connections] : data.connections
					);
					setConnectionsNextKey(data.next_pagination_key);
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setConnectionsLoading(false);
			}
		},
		[sessionToken, t]
	);

	const fetchIncoming = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setIncomingLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const res = await fetch(
					`${apiBaseUrl}/hub/connections/list-incoming-requests`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify({
							limit: PAGE_SIZE,
							pagination_key: paginationKey,
						}),
					}
				);
				if (res.status === 200) {
					const data: ListIncomingRequestsResponse = await res.json();
					setIncoming((prev) =>
						paginationKey ? [...prev, ...data.incoming] : data.incoming
					);
					setIncomingNextKey(data.next_pagination_key);
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setIncomingLoading(false);
			}
		},
		[sessionToken, t]
	);

	const fetchOutgoing = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setOutgoingLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const res = await fetch(
					`${apiBaseUrl}/hub/connections/list-outgoing-requests`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify({
							limit: PAGE_SIZE,
							pagination_key: paginationKey,
						}),
					}
				);
				if (res.status === 200) {
					const data: ListOutgoingRequestsResponse = await res.json();
					setOutgoing((prev) =>
						paginationKey ? [...prev, ...data.outgoing] : data.outgoing
					);
					setOutgoingNextKey(data.next_pagination_key);
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setOutgoingLoading(false);
			}
		},
		[sessionToken, t]
	);

	const fetchBlocked = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setBlockedLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListBlockedRequest = {
					limit: PAGE_SIZE,
					pagination_key: paginationKey,
				};
				const res = await fetch(`${apiBaseUrl}/hub/connections/list-blocked`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data = await res.json();
					setBlocked((prev) =>
						paginationKey ? [...prev, ...data.blocked] : data.blocked
					);
					setBlockedNextKey(data.next_pagination_key);
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setBlockedLoading(false);
			}
		},
		[sessionToken, t]
	);

	useEffect(() => {
		fetchCounts();
		fetchConnections();
		fetchIncoming();
	}, [fetchCounts, fetchConnections, fetchIncoming]);

	useEffect(() => {
		if (activeTab === "outgoing" && outgoing.length === 0) fetchOutgoing();
		if (activeTab === "blocked" && blocked.length === 0) fetchBlocked();
	}, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

	// Debounced search
	useEffect(() => {
		if (searchTimeout.current) clearTimeout(searchTimeout.current);
		if (!searchQuery.trim()) {
			setSearchResults(null);
			return;
		}
		searchTimeout.current = setTimeout(async () => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: SearchConnectionsRequest = { query: searchQuery };
				const res = await fetch(`${apiBaseUrl}/hub/connections/search`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data = await res.json();
					setSearchResults(data.results);
				}
			} catch {
				// ignore search errors
			}
		}, 300);
		return () => {
			if (searchTimeout.current) clearTimeout(searchTimeout.current);
		};
	}, [searchQuery, sessionToken]);

	const handleDisconnect = async (handle: string) => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/connections/disconnect`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (res.status === 204) {
				message.success(t("success.disconnected"));
				setConnections((prev) => prev.filter((c) => c.handle !== handle));
				setSearchResults((prev) =>
					prev ? prev.filter((c) => c.handle !== handle) : null
				);
				fetchCounts();
			} else {
				message.error(t("errors.actionFailed"));
			}
		} catch {
			message.error(t("errors.actionFailed"));
		}
	};

	const handleAccept = async (handle: string) => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/connections/accept-request`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (res.status === 200) {
				message.success(t("success.accepted"));
				setIncoming((prev) => prev.filter((r) => r.handle !== handle));
				fetchCounts();
				fetchConnections();
			} else {
				message.error(t("errors.actionFailed"));
			}
		} catch {
			message.error(t("errors.actionFailed"));
		}
	};

	const handleReject = async (handle: string) => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/connections/reject-request`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (res.status === 204) {
				message.success(t("success.rejected"));
				setIncoming((prev) => prev.filter((r) => r.handle !== handle));
				fetchCounts();
			} else {
				message.error(t("errors.actionFailed"));
			}
		} catch {
			message.error(t("errors.actionFailed"));
		}
	};

	const handleWithdraw = async (handle: string) => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(
				`${apiBaseUrl}/hub/connections/withdraw-request`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ handle }),
				}
			);
			if (res.status === 204) {
				message.success(t("success.withdrawn"));
				setOutgoing((prev) => prev.filter((r) => r.handle !== handle));
				fetchCounts();
			} else {
				message.error(t("errors.actionFailed"));
			}
		} catch {
			message.error(t("errors.actionFailed"));
		}
	};

	const handleUnblock = async (handle: string) => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/connections/unblock`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ handle }),
			});
			if (res.status === 204) {
				message.success(t("success.unblocked"));
				setBlocked((prev) => prev.filter((b) => b.handle !== handle));
				fetchCounts();
			} else {
				message.error(t("errors.actionFailed"));
			}
		} catch {
			message.error(t("errors.actionFailed"));
		}
	};

	const displayedConnections = searchResults ?? connections;

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 800,
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
					alignItems: "center",
					gap: 12,
					marginBottom: 24,
				}}
			>
				<TeamOutlined style={{ fontSize: 24 }} />
				<Title level={2} style={{ margin: 0 }}>
					{t("title")}
				</Title>
				{counts && (
					<Text type="secondary" style={{ fontSize: 15 }}>
						· {counts.connected}{" "}
						{t("tabs.connections", { count: counts.connected })
							.split("(")[0]
							.trim()
							.toLowerCase()}
					</Text>
				)}
			</div>

			{/* ── Tabs: Incoming | My Connections | Sent | Blocked ────────────── */}
			<Tabs
				activeKey={activeTab}
				onChange={setActiveTab}
				items={[
					{
						key: "incoming",
						label: (
							<Badge
								count={counts?.pending_incoming ?? 0}
								size="small"
								offset={[6, -2]}
							>
								<span style={{ paddingRight: 4 }}>{t("tabs.incoming")}</span>
							</Badge>
						),
						children: (
							<Spin spinning={incomingLoading}>
								{incoming.length === 0 && !incomingLoading ? (
									<Text
										type="secondary"
										style={{
											display: "block",
											textAlign: "center",
											padding: "32px 0",
										}}
									>
										{t("empty.incoming")}
									</Text>
								) : (
									<div>
										{incoming.map((r) => (
											<PersonRow
												key={r.handle}
												handle={r.handle}
												displayName={r.display_name}
												shortBio={r.short_bio}
												hasPicture={r.has_profile_picture}
												secondaryText={
													t("columns.requestedAt") +
													": " +
													formatDateTime(r.created_at, i18n.language)
												}
												onClick={() => navigate(`/u/${r.handle}`)}
												actions={
													<div style={{ display: "flex", gap: 8 }}>
														<Button
															type="primary"
															size="small"
															onClick={() => handleAccept(r.handle)}
														>
															{t("actions.accept")}
														</Button>
														<Button
															size="small"
															onClick={() => handleReject(r.handle)}
														>
															{t("actions.reject")}
														</Button>
													</div>
												}
											/>
										))}
									</div>
								)}
								{incomingNextKey && (
									<div style={{ textAlign: "center", marginTop: 16 }}>
										<Button
											onClick={() => fetchIncoming(incomingNextKey)}
											loading={incomingLoading}
										>
											{t("loadMore")}
										</Button>
									</div>
								)}
							</Spin>
						),
					},
					{
						key: "connections",
						label: (
							<span>
								{t("tabs.myConnections")}
								{counts?.connected ? (
									<Text
										type="secondary"
										style={{ marginLeft: 6, fontSize: 12 }}
									>
										({counts.connected})
									</Text>
								) : null}
							</span>
						),
						children: (
							<>
								<Search
									placeholder={t("search.placeholder")}
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									allowClear
									style={{ maxWidth: 400, marginBottom: 16 }}
								/>
								<Spin spinning={connectionsLoading}>
									{displayedConnections.length === 0 && !connectionsLoading ? (
										<Text
											type="secondary"
											style={{
												display: "block",
												textAlign: "center",
												padding: "32px 0",
											}}
										>
											{searchQuery
												? t("empty.searchConnections")
												: t("empty.connections")}
										</Text>
									) : (
										<div>
											{displayedConnections.map((c) => (
												<PersonRow
													key={c.handle}
													handle={c.handle}
													displayName={c.display_name}
													shortBio={c.short_bio}
													hasPicture={c.has_profile_picture}
													secondaryText={
														t("columns.connectedAt") +
														": " +
														formatDateTime(c.connected_at, i18n.language)
													}
													onClick={() => navigate(`/u/${c.handle}`)}
													actions={
														<Popconfirm
															title={t("disconnectConfirm.title")}
															description={t("disconnectConfirm.description")}
															onConfirm={() => handleDisconnect(c.handle)}
															okText={t("disconnectConfirm.ok")}
															cancelText={t("disconnectConfirm.cancel")}
														>
															<Button size="small" danger>
																{t("actions.disconnect")}
															</Button>
														</Popconfirm>
													}
												/>
											))}
										</div>
									)}
								</Spin>
								{!searchResults && connectionsNextKey && (
									<div style={{ textAlign: "center", marginTop: 16 }}>
										<Button
											onClick={() => fetchConnections(connectionsNextKey)}
											loading={connectionsLoading}
										>
											{t("loadMore")}
										</Button>
									</div>
								)}
							</>
						),
					},
					{
						key: "outgoing",
						label: (
							<span>
								{t("tabs.outgoingShort")}
								{(counts?.pending_outgoing ?? 0) > 0 && (
									<Text
										type="secondary"
										style={{ marginLeft: 6, fontSize: 12 }}
									>
										({counts?.pending_outgoing})
									</Text>
								)}
							</span>
						),
						children: (
							<Spin spinning={outgoingLoading}>
								{outgoing.length === 0 && !outgoingLoading ? (
									<Text
										type="secondary"
										style={{
											display: "block",
											textAlign: "center",
											padding: "32px 0",
										}}
									>
										{t("empty.outgoing")}
									</Text>
								) : (
									<div>
										{outgoing.map((r) => (
											<PersonRow
												key={r.handle}
												handle={r.handle}
												displayName={r.display_name}
												shortBio={r.short_bio}
												hasPicture={r.has_profile_picture}
												secondaryText={
													t("columns.requestedAt") +
													": " +
													formatDateTime(r.created_at, i18n.language)
												}
												onClick={() => navigate(`/u/${r.handle}`)}
												actions={
													<Popconfirm
														title={t("withdrawConfirm")}
														onConfirm={() => handleWithdraw(r.handle)}
														okText={t("actions.withdraw")}
														cancelText={t("disconnectConfirm.cancel")}
													>
														<Button size="small">
															{t("actions.withdraw")}
														</Button>
													</Popconfirm>
												}
											/>
										))}
									</div>
								)}
								{outgoingNextKey && (
									<div style={{ textAlign: "center", marginTop: 16 }}>
										<Button
											onClick={() => fetchOutgoing(outgoingNextKey)}
											loading={outgoingLoading}
										>
											{t("loadMore")}
										</Button>
									</div>
								)}
							</Spin>
						),
					},
					{
						key: "blocked",
						label: t("tabs.blockedShort"),
						children: (
							<Spin spinning={blockedLoading}>
								{blocked.length === 0 && !blockedLoading ? (
									<Text
										type="secondary"
										style={{
											display: "block",
											textAlign: "center",
											padding: "32px 0",
										}}
									>
										{t("empty.blocked")}
									</Text>
								) : (
									<div>
										{blocked.map((b) => (
											<PersonRow
												key={b.handle}
												handle={b.handle}
												displayName={b.display_name}
												secondaryText={
													t("columns.blockedAt") +
													": " +
													formatDateTime(b.blocked_at, i18n.language)
												}
												actions={
													<Button
														size="small"
														onClick={() => handleUnblock(b.handle)}
													>
														{t("actions.unblock")}
													</Button>
												}
											/>
										))}
									</div>
								)}
								{blockedNextKey && (
									<div style={{ textAlign: "center", marginTop: 16 }}>
										<Button
											onClick={() => fetchBlocked(blockedNextKey)}
											loading={blockedLoading}
										>
											{t("loadMore")}
										</Button>
									</div>
								)}
							</Spin>
						),
					},
				]}
			/>
		</div>
	);
}
