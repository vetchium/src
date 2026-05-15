import {
	TeamOutlined,
	UserOutlined,
	ArrowLeftOutlined,
} from "@ant-design/icons";
import {
	Avatar,
	Button,
	Input,
	Popconfirm,
	Spin,
	Table,
	Tabs,
	Tag,
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

export function ConnectionsPage() {
	const { t, i18n } = useTranslation("connections");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();

	const [counts, setCounts] = useState<ConnectionCounts | null>(null);
	const [activeTab, setActiveTab] = useState("connections");

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
			// counts are decorative; don't block the page
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
	}, [fetchCounts, fetchConnections]);

	// Lazy-load other tabs on first visit
	useEffect(() => {
		if (activeTab === "incoming" && incoming.length === 0) fetchIncoming();
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

	const userCell = (
		handle: string,
		displayName: string,
		shortBio?: string,
		hasPicture?: boolean
	) => (
		<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
			{hasPicture ? (
				<img
					src={`/hub/profile-picture/${handle}`}
					alt={displayName}
					style={{
						width: 40,
						height: 40,
						borderRadius: "50%",
						objectFit: "cover",
					}}
				/>
			) : (
				<Avatar size={40} icon={<UserOutlined />} />
			)}
			<div>
				<div>
					<a
						onClick={() => navigate(`/u/${handle}`)}
						style={{ cursor: "pointer" }}
					>
						{displayName}
					</a>
				</div>
				<Text
					type="secondary"
					style={{ fontFamily: "monospace", fontSize: 12 }}
				>
					@{handle}
				</Text>
				{shortBio && (
					<div>
						<Text type="secondary" style={{ fontSize: 12 }}>
							{shortBio}
						</Text>
					</div>
				)}
			</div>
		</div>
	);

	const displayedConnections = searchResults ?? connections;

	const connectionsColumns = [
		{
			title: t("columns.user"),
			key: "user",
			render: (_: unknown, r: Connection) =>
				userCell(r.handle, r.display_name, r.short_bio, r.has_profile_picture),
		},
		{
			title: t("columns.connectedAt"),
			dataIndex: "connected_at",
			key: "connected_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("columns.actions"),
			key: "actions",
			render: (_: unknown, r: Connection) => (
				<Popconfirm
					title={t("disconnectConfirm.title")}
					description={t("disconnectConfirm.description")}
					onConfirm={() => handleDisconnect(r.handle)}
					okText={t("disconnectConfirm.ok")}
					cancelText={t("disconnectConfirm.cancel")}
				>
					<Button size="small" danger>
						{t("actions.disconnect")}
					</Button>
				</Popconfirm>
			),
		},
	];

	const incomingColumns = [
		{
			title: t("columns.user"),
			key: "user",
			render: (_: unknown, r: PendingRequest) =>
				userCell(r.handle, r.display_name, r.short_bio, r.has_profile_picture),
		},
		{
			title: t("columns.requestedAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("columns.actions"),
			key: "actions",
			render: (_: unknown, r: PendingRequest) => (
				<div style={{ display: "flex", gap: 8 }}>
					<Button
						type="primary"
						size="small"
						onClick={() => handleAccept(r.handle)}
					>
						{t("actions.accept")}
					</Button>
					<Button size="small" onClick={() => handleReject(r.handle)}>
						{t("actions.reject")}
					</Button>
				</div>
			),
		},
	];

	const outgoingColumns = [
		{
			title: t("columns.user"),
			key: "user",
			render: (_: unknown, r: PendingRequest) =>
				userCell(r.handle, r.display_name, r.short_bio, r.has_profile_picture),
		},
		{
			title: t("columns.requestedAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("columns.actions"),
			key: "actions",
			render: (_: unknown, r: PendingRequest) => (
				<Popconfirm
					title={t("withdrawConfirm")}
					onConfirm={() => handleWithdraw(r.handle)}
					okText={t("actions.withdraw")}
					cancelText={t("disconnectConfirm.cancel")}
				>
					<Button size="small">{t("actions.withdraw")}</Button>
				</Popconfirm>
			),
		},
	];

	const blockedColumns = [
		{
			title: t("columns.user"),
			key: "user",
			render: (_: unknown, r: BlockedUser) => (
				<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
					<Avatar size={40} icon={<UserOutlined />} />
					<div>
						<div>{r.display_name}</div>
						<Text
							type="secondary"
							style={{ fontFamily: "monospace", fontSize: 12 }}
						>
							@{r.handle}
						</Text>
					</div>
				</div>
			),
		},
		{
			title: t("columns.blockedAt"),
			dataIndex: "blocked_at",
			key: "blocked_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("columns.actions"),
			key: "actions",
			render: (_: unknown, r: BlockedUser) => (
				<Button size="small" onClick={() => handleUnblock(r.handle)}>
					{t("actions.unblock")}
				</Button>
			),
		},
	];

	const tabLabel = (key: string, count: number | undefined) => {
		const label = {
			connections: t("tabs.connections", { count: count ?? "…" }),
			incoming: t("tabs.incoming", { count: count ?? "…" }),
			outgoing: t("tabs.outgoing", { count: count ?? "…" }),
			blocked: t("tabs.blocked", { count: count ?? "…" }),
		}[key];
		return label ?? key;
	};

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
					<TeamOutlined style={{ marginRight: 12 }} />
					{t("title")}
				</Title>
				{counts && (
					<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
						<Tag color="blue">{counts.connected} connected</Tag>
						{counts.pending_incoming > 0 && (
							<Tag color="orange">{counts.pending_incoming} incoming</Tag>
						)}
						{counts.pending_outgoing > 0 && (
							<Tag>{counts.pending_outgoing} sent</Tag>
						)}
						{counts.blocked > 0 && (
							<Tag color="red">{counts.blocked} blocked</Tag>
						)}
					</div>
				)}
			</div>

			<Tabs
				activeKey={activeTab}
				onChange={setActiveTab}
				items={[
					{
						key: "connections",
						label: tabLabel("connections", counts?.connected),
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
									<Table
										dataSource={displayedConnections}
										columns={connectionsColumns}
										rowKey="handle"
										pagination={false}
										locale={{ emptyText: t("empty.connections") }}
									/>
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
						key: "incoming",
						label: tabLabel("incoming", counts?.pending_incoming),
						children: (
							<Spin spinning={incomingLoading}>
								<Table
									dataSource={incoming}
									columns={incomingColumns}
									rowKey="handle"
									pagination={false}
									locale={{ emptyText: t("empty.incoming") }}
								/>
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
						key: "outgoing",
						label: tabLabel("outgoing", counts?.pending_outgoing),
						children: (
							<Spin spinning={outgoingLoading}>
								<Table
									dataSource={outgoing}
									columns={outgoingColumns}
									rowKey="handle"
									pagination={false}
									locale={{ emptyText: t("empty.outgoing") }}
								/>
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
						label: tabLabel("blocked", counts?.blocked),
						children: (
							<Spin spinning={blockedLoading}>
								<Table
									dataSource={blocked}
									columns={blockedColumns}
									rowKey="handle"
									pagination={false}
									locale={{ emptyText: t("empty.blocked") }}
								/>
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
