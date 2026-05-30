import React, { useCallback, useEffect, useState } from "react";
import { Button, Empty, Spin, Table, Tag, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	OrgCandidacySummary,
	ListCandidaciesRequest,
	ListCandidaciesResponse,
} from "vetchium-specs/org/candidacies";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;

const STATE_COLORS: Record<string, string> = {
	interviewing: "blue",
	offered: "green",
	offer_accepted: "success",
	offer_declined: "orange",
	candidate_unsuitable: "red",
};

export const CandidaciesListPage: React.FC = () => {
	const { t, i18n } = useTranslation("candidacies");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const [candidacies, setCandidacies] = useState<OrgCandidacySummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();

	const fetchCandidacies = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListCandidaciesRequest = {
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
				};
				const res = await fetch(`${apiBaseUrl}/org/list-candidacies`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data: ListCandidaciesResponse = await res.json();
					setCandidacies((prev) =>
						paginationKey ? [...prev, ...data.candidacies] : data.candidacies
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
		fetchCandidacies();
	}, [fetchCandidacies]);

	const columns = [
		{
			title: t("candidate"),
			key: "candidate",
			render: (_: unknown, record: OrgCandidacySummary) => (
				<Link to={`/candidacies/${record.candidacy_id}`}>
					{record.candidate_display_name || record.candidate_handle}
				</Link>
			),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (state: string) => (
				<Tag color={STATE_COLORS[state] ?? "default"}>
					{t(state as "interviewing")}
				</Tag>
			),
		},
		{
			title: t("created"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, record: OrgCandidacySummary) => (
				<Link to={`/candidacies/${record.candidacy_id}`}>{t("view")}</Link>
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

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("title")}
			</Title>

			<Spin spinning={loading}>
				{candidacies.length === 0 && !loading ? (
					<Empty description={t("noCandidacies")} />
				) : (
					<Table
						dataSource={candidacies}
						columns={columns}
						rowKey="candidacy_id"
						pagination={false}
						onRow={(record) => ({
							onClick: () => navigate(`/candidacies/${record.candidacy_id}`),
							style: { cursor: "pointer" },
						})}
					/>
				)}
				{nextKey && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button onClick={() => fetchCandidacies(nextKey)} loading={loading}>
							Load more
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
};
