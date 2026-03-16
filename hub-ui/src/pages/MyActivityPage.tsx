import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import {
	Alert,
	Button,
	DatePicker,
	Form,
	Space,
	Spin,
	Table,
	Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import type { Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getApiBaseUrl } from "../config";
import type {
	FilterAuditLogsRequest,
	FilterAuditLogsResponse,
	AuditLogEntry,
} from "vetchium-specs/audit-logs/audit-logs";

const { Title } = Typography;

interface Filters {
	startTime: Dayjs | null;
	endTime: Dayjs | null;
}

const emptyFilters: Filters = {
	startTime: null,
	endTime: null,
};

export function MyActivityPage() {
	const { t } = useTranslation("auditLogs");
	const { sessionToken } = useAuth();

	const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [paginationKey, setPaginationKey] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);

	const [startTime, setStartTime] = useState<Dayjs | null>(null);
	const [endTime, setEndTime] = useState<Dayjs | null>(null);
	const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);

	const doFetch = useCallback(
		async (filters: Filters, cursor: string | null, append: boolean) => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const reqBody: FilterAuditLogsRequest = {
					limit: 40,
					...(filters.startTime && {
						start_time: filters.startTime.toISOString(),
					}),
					...(filters.endTime && { end_time: filters.endTime.toISOString() }),
					...(cursor && { pagination_key: cursor }),
				};
				const response = await fetch(`${apiBaseUrl}/hub/my-audit-logs`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(reqBody),
				});
				if (response.status !== 200) {
					setError(t("error"));
					return;
				}
				const data: FilterAuditLogsResponse = await response.json();
				setAuditLogs((prev) =>
					append ? [...prev, ...data.audit_logs] : data.audit_logs
				);
				setPaginationKey(data.pagination_key);
				setError(null);
			} catch {
				setError(t("error"));
			}
		},
		[sessionToken, t]
	);

	useEffect(() => {
		const run = async () => {
			await doFetch(emptyFilters, null, false);
			setLoading(false);
		};
		run();
	}, [doFetch]);

	const handleSearch = async () => {
		const filters: Filters = { startTime, endTime };
		setAppliedFilters(filters);
		setLoading(true);
		setAuditLogs([]);
		setPaginationKey(null);
		await doFetch(filters, null, false);
		setLoading(false);
	};

	const handleReset = async () => {
		setStartTime(null);
		setEndTime(null);
		setAppliedFilters(emptyFilters);
		setLoading(true);
		setAuditLogs([]);
		setPaginationKey(null);
		await doFetch(emptyFilters, null, false);
		setLoading(false);
	};

	const handleLoadMore = async () => {
		if (!paginationKey || loadingMore) return;
		setLoadingMore(true);
		await doFetch(appliedFilters, paginationKey, true);
		setLoadingMore(false);
	};

	const columns: TableColumnsType<AuditLogEntry> = [
		{
			title: t("table.timestamp"),
			dataIndex: "created_at",
			key: "created_at",
			render: (val: string) => new Date(val).toLocaleString(),
			width: 180,
		},
		{
			title: t("table.eventType"),
			dataIndex: "event_type",
			key: "event_type",
			width: 220,
		},
		{
			title: t("table.ipAddress"),
			dataIndex: "ip_address",
			key: "ip_address",
			width: 140,
		},
		{
			title: t("table.eventData"),
			dataIndex: "event_data",
			key: "event_data",
			render: (val: Record<string, unknown>) => {
				if (Object.keys(val).length === 0) return "—";
				return (
					<pre
						style={{
							margin: 0,
							fontSize: 12,
							maxHeight: 200,
							overflow: "auto",
						}}
					>
						{JSON.stringify(val, null, 2)}
					</pre>
				);
			},
		},
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
			<Title level={2}>{t("title")}</Title>

			<div
				style={{
					marginBottom: 16,
					padding: 16,
					background: "rgba(0,0,0,0.02)",
					borderRadius: 8,
					border: "1px solid rgba(0,0,0,0.06)",
				}}
			>
				<Form layout="vertical">
					<Space wrap>
						<Form.Item
							label={t("filterPanel.startTime")}
							style={{ marginBottom: 0 }}
						>
							<DatePicker
								showTime
								value={startTime}
								onChange={(val) => setStartTime(val)}
							/>
						</Form.Item>
						<Form.Item
							label={t("filterPanel.endTime")}
							style={{ marginBottom: 0 }}
						>
							<DatePicker
								showTime
								value={endTime}
								onChange={(val) => setEndTime(val)}
							/>
						</Form.Item>
					</Space>
					<div style={{ marginTop: 16 }}>
						<Space>
							<Button type="primary" onClick={handleSearch}>
								{t("filterPanel.search")}
							</Button>
							<Button onClick={handleReset}>{t("filterPanel.reset")}</Button>
						</Space>
					</div>
				</Form>
			</div>

			{error && (
				<Alert type="error" title={error} style={{ marginBottom: 16 }} />
			)}

			<Spin spinning={loading}>
				<Table
					dataSource={auditLogs}
					columns={columns}
					rowKey="id"
					pagination={false}
					scroll={{ x: "max-content" }}
					locale={{ emptyText: t("empty") }}
				/>
				{paginationKey && !loading && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button
							onClick={handleLoadMore}
							loading={loadingMore}
							disabled={loadingMore}
						>
							{t("loadMore")}
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
}
