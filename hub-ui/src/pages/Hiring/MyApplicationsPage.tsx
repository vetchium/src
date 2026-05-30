import React, { useCallback, useEffect, useState } from "react";
import { Button, Empty, Spin, Table, Tag, Typography } from "antd";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	HubApplicationSummary,
	ListMyApplicationsRequest,
	ListMyApplicationsResponse,
} from "vetchium-specs/hub/applications";
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

export const MyApplicationsPage: React.FC = () => {
	const { t, i18n } = useTranslation("applications");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const [applications, setApplications] = useState<HubApplicationSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();

	const fetchApplications = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListMyApplicationsRequest = {
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
				};
				const res = await fetch(`${apiBaseUrl}/hub/list-my-applications`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data: ListMyApplicationsResponse = await res.json();
					setApplications((prev) =>
						paginationKey ? [...prev, ...data.applications] : data.applications
					);
					setNextKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken]
	);

	useEffect(() => {
		fetchApplications();
	}, [fetchApplications]);

	const columns = [
		{
			title: t("role"),
			key: "role",
			render: (_: unknown, record: HubApplicationSummary) => (
				<Link to={`/my-applications/${record.application_id}`}>
					{record.opening_title || `#${record.opening_number}`}
				</Link>
			),
		},
		{
			title: t("company"),
			key: "company",
			render: (_: unknown, record: HubApplicationSummary) =>
				record.org_name || record.org_domain,
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
			title: t("appliedDate"),
			dataIndex: "applied_at",
			key: "applied_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, record: HubApplicationSummary) => (
				<Link to={`/my-applications/${record.application_id}`}>
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
					{t("title")}
				</Title>
				<Link to="/openings">
					<Button type="primary" icon={<PlusOutlined />}>
						Apply to Job
					</Button>
				</Link>
			</div>

			<Spin spinning={loading}>
				{applications.length === 0 && !loading ? (
					<Empty description={t("noApplications")} />
				) : (
					<Table
						dataSource={applications}
						columns={columns}
						rowKey="application_id"
						pagination={false}
						onRow={(record) => ({
							onClick: () =>
								navigate(`/my-applications/${record.application_id}`),
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
