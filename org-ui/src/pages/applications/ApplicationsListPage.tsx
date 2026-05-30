import React, { useCallback, useEffect, useState } from "react";
import { Button, Empty, Select, Spin, Table, Tag, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	OrgApplicationSummary,
	ListApplicationsRequest,
	ListApplicationsResponse,
} from "vetchium-specs/org/applications";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;

const STATE_COLORS: Record<string, string> = {
	applied: "blue",
	shortlisted: "green",
	rejected: "red",
	withdrawn: "default",
	expired: "default",
};

const LABEL_COLORS: Record<string, string> = {
	green: "success",
	yellow: "warning",
	red: "error",
};

export const ApplicationsListPage: React.FC = () => {
	const { t, i18n } = useTranslation("applications");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { openingId } = useParams<{ openingId: string }>();
	const [applications, setApplications] = useState<OrgApplicationSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [stateFilter, setStateFilter] = useState<string[]>([]);

	const fetchApplications = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken || !openingId) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListApplicationsRequest = {
					opening_id: openingId,
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
					...(stateFilter.length > 0
						? {
								filter_state:
									stateFilter as ListApplicationsRequest["filter_state"],
							}
						: {}),
				};
				const res = await fetch(`${apiBaseUrl}/org/list-applications`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data: ListApplicationsResponse = await res.json();
					setApplications((prev) =>
						paginationKey ? [...prev, ...data.applications] : data.applications
					);
					setNextKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, openingId, stateFilter]
	);

	useEffect(() => {
		fetchApplications();
	}, [fetchApplications]);

	const columns = [
		{
			title: t("candidate"),
			dataIndex: "candidate_handle",
			key: "candidate_handle",
			render: (handle: string, record: OrgApplicationSummary) => (
				<Link
					to={`/openings/${openingId}/applications/${record.application_id}`}
				>
					{record.candidate_display_name || handle}
				</Link>
			),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (state: string) => (
				<Tag color={STATE_COLORS[state] ?? "default"}>
					{t(state as "applied")}
				</Tag>
			),
		},
		{
			title: t("label"),
			dataIndex: "label",
			key: "label",
			render: (label: string | undefined) =>
				label ? (
					<Tag color={LABEL_COLORS[label] ?? "default"}>
						{t(
							`label${label.charAt(0).toUpperCase() + label.slice(1)}` as "labelGreen"
						)}
					</Tag>
				) : (
					<span style={{ color: "#999" }}>{t("labelNone")}</span>
				),
		},
		{
			title: t("appliedDate"),
			dataIndex: "applied_at",
			key: "applied_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, record: OrgApplicationSummary) => (
				<Link
					to={`/openings/${openingId}/applications/${record.application_id}`}
				>
					{t("view")}
				</Link>
			),
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
				<Link to={`/openings/${openingId}`}>
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("title")}
			</Title>

			<div style={{ marginBottom: 16 }}>
				<Select
					mode="multiple"
					placeholder="Filter by state"
					style={{ width: 300 }}
					value={stateFilter}
					onChange={(v) => setStateFilter(v)}
					options={[
						{ value: "applied", label: t("applied") },
						{ value: "shortlisted", label: t("shortlisted") },
						{ value: "rejected", label: t("rejected") },
						{ value: "withdrawn", label: t("withdrawn") },
					]}
					allowClear
				/>
			</div>

			<Spin spinning={loading}>
				{applications.length === 0 && !loading ? (
					<Empty />
				) : (
					<Table
						dataSource={applications}
						columns={columns}
						rowKey="application_id"
						pagination={false}
						onRow={(record) => ({
							onClick: () =>
								navigate(
									`/openings/${openingId}/applications/${record.application_id}`
								),
							style: { cursor: "pointer" },
						})}
					/>
				)}
				{nextKey && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button
							onClick={() => fetchApplications(nextKey)}
							loading={loading}
						>
							Load more
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
};
