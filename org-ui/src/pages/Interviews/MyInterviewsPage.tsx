import React, { useCallback, useEffect, useState } from "react";
import { Button, Empty, Spin, Table, Tag, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	OrgMyInterview,
	ListMyInterviewsRequest,
	ListMyInterviewsResponse,
} from "vetchium-specs/org/interviews";
import type { InterviewState } from "vetchium-specs/hub/candidacies";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;

const STATE_COLORS: Record<InterviewState, string> = {
	scheduled: "blue",
	completed: "green",
	cancelled: "red",
};

export const MyInterviewsPage: React.FC = () => {
	const { t, i18n } = useTranslation("interviews");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const [interviews, setInterviews] = useState<OrgMyInterview[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();

	const fetchInterviews = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListMyInterviewsRequest = {
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
				};
				const res = await fetch(`${apiBaseUrl}/org/list-my-interviews`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data: ListMyInterviewsResponse = await res.json();
					setInterviews((prev) =>
						paginationKey ? [...prev, ...data.interviews] : data.interviews
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
		fetchInterviews();
	}, [fetchInterviews]);

	const rsvpLabel = (rsvp?: "yes" | "no"): string => {
		if (rsvp === "yes") return t("rsvpYes");
		if (rsvp === "no") return t("rsvpNo");
		return t("rsvpNone");
	};

	const columns = [
		{
			title: t("candidate"),
			dataIndex: "candidate_name",
			key: "candidate_name",
			render: (name: string, record: OrgMyInterview) => (
				<Link to={`/candidacies/${record.candidacy_id}`}>{name}</Link>
			),
		},
		{
			title: t("role"),
			dataIndex: "opening_title",
			key: "opening_title",
		},
		{
			title: t("when"),
			dataIndex: "starts_at",
			key: "starts_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("interviewType"),
			dataIndex: "interview_type",
			key: "interview_type",
			render: (type: string) => t(type as "video"),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (state: InterviewState) => (
				<Tag color={STATE_COLORS[state] ?? "default"}>
					{t(state as "scheduled")}
				</Tag>
			),
		},
		{
			title: t("myRsvp"),
			dataIndex: "my_rsvp",
			key: "my_rsvp",
			render: (rsvp?: "yes" | "no") => rsvpLabel(rsvp),
		},
		{
			title: t("feedback"),
			dataIndex: "feedback_submitted",
			key: "feedback_submitted",
			render: (done: boolean) =>
				done ? (
					<Tag color="green">{t("feedbackDone")}</Tag>
				) : (
					<Tag>{t("feedbackPending")}</Tag>
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
				{t("myInterviewsTitle")}
			</Title>

			<Spin spinning={loading}>
				{interviews.length === 0 && !loading ? (
					<Empty description={t("myInterviewsEmpty")} />
				) : (
					<Table
						dataSource={interviews}
						columns={columns}
						rowKey="interview_id"
						pagination={false}
						onRow={(record) => ({
							onClick: () => navigate(`/candidacies/${record.candidacy_id}`),
							style: { cursor: "pointer" },
						})}
					/>
				)}
				{nextKey && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button onClick={() => fetchInterviews(nextKey)} loading={loading}>
							{t("loadMore")}
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
};
