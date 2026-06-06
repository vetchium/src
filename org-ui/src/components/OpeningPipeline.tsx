import React, { useCallback, useEffect, useState } from "react";
import { Card, Empty, Space, Spin, Table, Tag, Typography } from "antd";
import { TeamOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
	ListCandidaciesRequest,
	ListCandidaciesResponse,
	OrgCandidacySummary,
} from "vetchium-specs/org/candidacies";
import type { CandidacyState } from "vetchium-specs/hub/candidacies";
import { getApiBaseUrl } from "../config";
import { formatDate } from "../utils/dateFormat";

const { Text } = Typography;

const STATE_COLORS: Record<CandidacyState, string> = {
	interviewing: "blue",
	offered: "green",
	offer_accepted: "success",
	offer_declined: "orange",
	candidate_unsuitable: "red",
	candidate_not_responding: "volcano",
	employer_defunct: "default",
};

const ACTIVE_STATES: CandidacyState[] = [
	"interviewing",
	"offered",
	"offer_accepted",
];

interface Props {
	sessionToken: string | null;
	openingId: string;
}

/**
 * The candidate pipeline for an opening: everyone who has been shortlisted into a
 * candidacy, with their stage and interview progress, so HR sees the funnel
 * without clicking through the Applications list.
 */
export const OpeningPipeline: React.FC<Props> = ({
	sessionToken,
	openingId,
}) => {
	const { t, i18n } = useTranslation("candidacies");
	const [rows, setRows] = useState<OrgCandidacySummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [forbidden, setForbidden] = useState(false);

	const load = useCallback(async () => {
		if (!sessionToken || !openingId) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: ListCandidaciesRequest = {
				filter_opening_id: openingId,
				limit: 100,
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
				setRows(data.candidacies);
			} else if (res.status === 403) {
				setForbidden(true);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, openingId]);

	useEffect(() => {
		load();
	}, [load]);

	if (forbidden) return null;

	// Per-stage counts for a quick funnel summary.
	const counts = rows.reduce<Record<string, number>>((acc, r) => {
		acc[r.state] = (acc[r.state] ?? 0) + 1;
		return acc;
	}, {});
	const activeCount = rows.filter((r) =>
		ACTIVE_STATES.includes(r.state)
	).length;

	const columns = [
		{
			title: t("candidate"),
			key: "candidate",
			render: (_: unknown, r: OrgCandidacySummary) => (
				<Link to={`/candidacies/${r.candidacy_id}`}>
					{r.candidate_display_name || r.candidate_handle}
				</Link>
			),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (s: CandidacyState) => (
				<Tag color={STATE_COLORS[s] ?? "default"}>{t(s)}</Tag>
			),
		},
		{
			title: t("pipelineInterviews"),
			dataIndex: "scheduled_interview_count",
			key: "interviews",
			render: (n: number) => n ?? 0,
		},
		{
			title: t("created"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDate(v, i18n.language),
		},
	];

	return (
		<Card
			title={
				<Space>
					<TeamOutlined />
					{t("pipelineTitle")}
				</Space>
			}
			style={{ marginBottom: 16 }}
		>
			<Spin spinning={loading}>
				{rows.length === 0 && !loading ? (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={t("pipelineEmpty")}
					/>
				) : (
					<>
						<Space wrap style={{ marginBottom: 12 }}>
							<Text strong>{t("pipelineActive", { count: activeCount })}</Text>
							{(Object.keys(counts) as CandidacyState[]).map((s) => (
								<Tag key={s} color={STATE_COLORS[s] ?? "default"}>
									{t(s)}: {counts[s]}
								</Tag>
							))}
						</Space>
						<Table
							dataSource={rows}
							columns={columns}
							rowKey="candidacy_id"
							pagination={false}
							size="small"
						/>
					</>
				)}
			</Spin>
		</Card>
	);
};
