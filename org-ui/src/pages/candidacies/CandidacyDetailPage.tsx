import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
	Button,
	Card,
	Descriptions,
	Empty,
	Input,
	Space,
	Spin,
	Table,
	Tag,
	Timeline,
	Typography,
	message,
} from "antd";
import {
	ArrowLeftOutlined,
	CalendarOutlined,
	DollarOutlined,
	DownloadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type {
	CandidacyIdRequest,
	OrgAddCandidacyCommentRequest,
	OrgCandidacy,
	OrgInterviewSummary,
} from "vetchium-specs/org/candidacies";
import type {
	CandidacyComment,
	CandidacyState,
	InterviewState,
	InterviewType,
} from "vetchium-specs/hub/candidacies";
import type {
	InterviewIdRequest,
	OrgInterview,
	FeedbackDecision,
} from "vetchium-specs/org/interviews";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDate, formatDateTime } from "../../utils/dateFormat";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const CANDIDACY_STATE_COLORS: Record<CandidacyState, string> = {
	interviewing: "blue",
	offered: "green",
	offer_accepted: "success",
	offer_declined: "orange",
	candidate_unsuitable: "red",
	candidate_not_responding: "volcano",
	employer_defunct: "default",
};

const INTERVIEW_STATE_COLORS: Record<InterviewState, string> = {
	scheduled: "blue",
	completed: "green",
	cancelled: "default",
};

// Strong positive→negative colour scale, mirroring the feedback editor, so the
// hiring team can read a decision at a glance on the candidacy page.
const DECISION_META: Record<FeedbackDecision, { color: string; key: string }> =
	{
		strong_yes: { color: "#237804", key: "decisionStrongYes" },
		yes: { color: "#52c41a", key: "decisionYes" },
		neutral: { color: "#8c8c8c", key: "decisionNeutral" },
		no: { color: "#ff4d4f", key: "decisionNo" },
		strong_no: { color: "#a8071a", key: "decisionStrongNo" },
	};

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

const CandidacyDetailPage: React.FC = () => {
	const { t, i18n } = useTranslation("candidacies");
	const navigate = useNavigate();
	const { candidacyId } = useParams<{ candidacyId: string }>();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const [candidacy, setCandidacy] = useState<OrgCandidacy | null>(null);
	const [loading, setLoading] = useState(false);
	const [commentText, setCommentText] = useState("");
	const [postingComment, setPostingComment] = useState(false);
	// Per-interview detail (interviewer RSVPs + feedback status), lazily fetched
	// when a row is expanded, keyed by interview_id.
	const [interviewDetails, setInterviewDetails] = useState<
		Record<string, OrgInterview | "loading">
	>({});

	const canManage =
		myInfo?.roles?.includes("org:manage_candidacies") ||
		myInfo?.roles?.includes("org:superadmin") ||
		false;

	const fetchCandidacy = useCallback(async () => {
		if (!sessionToken || !candidacyId) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: CandidacyIdRequest = { candidacy_id: candidacyId };
			const res = await fetch(`${apiBaseUrl}/org/get-candidacy`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				setCandidacy((await res.json()) as OrgCandidacy);
			} else {
				message.error(t("loadFailed"));
				navigate("/candidacies");
			}
		} catch {
			message.error(t("loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, candidacyId, navigate, t]);

	useEffect(() => {
		fetchCandidacy();
	}, [fetchCandidacy]);

	const handlePostComment = async () => {
		if (!sessionToken || !candidacyId || !commentText.trim()) return;
		setPostingComment(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: OrgAddCandidacyCommentRequest = {
				candidacy_id: candidacyId,
				body: commentText.trim(),
			};
			const res = await fetch(`${apiBaseUrl}/org/add-candidacy-comment`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				setCommentText("");
				message.success(t("commentPosted"));
				fetchCandidacy();
			} else {
				message.error(t("commentFailed"));
			}
		} catch {
			message.error(t("commentFailed"));
		} finally {
			setPostingComment(false);
		}
	};

	const fetchInterviewDetail = useCallback(
		async (interviewId: string) => {
			if (!sessionToken) return;
			setInterviewDetails((prev) => ({ ...prev, [interviewId]: "loading" }));
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: InterviewIdRequest = { interview_id: interviewId };
				const res = await fetch(`${apiBaseUrl}/org/get-interview`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data = (await res.json()) as OrgInterview;
					setInterviewDetails((prev) => ({ ...prev, [interviewId]: data }));
				} else {
					setInterviewDetails((prev) => {
						const next = { ...prev };
						delete next[interviewId];
						return next;
					});
				}
			} catch {
				setInterviewDetails((prev) => {
					const next = { ...prev };
					delete next[interviewId];
					return next;
				});
			}
		},
		[sessionToken]
	);

	const rsvpLabel = (rsvp?: "yes" | "no"): string =>
		rsvp === "yes"
			? t("rsvpYes")
			: rsvp === "no"
				? t("rsvpNo")
				: t("rsvpPending");

	const rsvpColor = (rsvp?: "yes" | "no"): string =>
		rsvp === "yes" ? "green" : rsvp === "no" ? "red" : "default";

	const renderInterviewerPanel = (interviewId: string) => {
		const detail = interviewDetails[interviewId];
		if (detail === undefined || detail === "loading") {
			return (
				<div style={{ padding: 16, textAlign: "center" }}>
					<Spin size="small" />
				</div>
			);
		}
		return (
			<div style={{ padding: "8px 16px" }}>
				{(detail.interview_location || detail.description) && (
					<div style={{ marginBottom: 12 }}>
						{detail.description && (
							<div>
								<Text type="secondary">{detail.description}</Text>
							</div>
						)}
						{detail.interview_location && (
							<div>
								<Text type="secondary">📍 {detail.interview_location}</Text>
							</div>
						)}
					</div>
				)}

				<Text strong>{t("interviewerRsvpSummary")}</Text>
				{detail.interviewers.length === 0 ? (
					<div style={{ marginTop: 8 }}>
						<Text type="secondary">{t("noInterviewers")}</Text>
					</div>
				) : (
					<Table
						style={{ marginTop: 8 }}
						dataSource={detail.interviewers}
						rowKey="org_user_id"
						pagination={false}
						size="small"
						columns={[
							{
								title: t("interviewer"),
								key: "interviewer",
								render: (_: unknown, r) =>
									r.display_name || r.org_user_email_address,
							},
							{
								title: t("rsvp"),
								dataIndex: "rsvp",
								key: "rsvp",
								render: (rsvp?: "yes" | "no") => (
									<Tag color={rsvpColor(rsvp)}>{rsvpLabel(rsvp)}</Tag>
								),
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
						]}
					/>
				)}

				{/* Submitted feedback content, visible to the hiring team (#2). */}
				<div style={{ marginTop: 16 }}>
					<Text strong>{t("submittedFeedback")}</Text>
					{detail.feedback.length === 0 ? (
						<div style={{ marginTop: 8 }}>
							<Text type="secondary">{t("noFeedbackYet")}</Text>
						</div>
					) : (
						detail.feedback.map((f, i) => {
							const meta = DECISION_META[f.decision];
							return (
								<Card
									key={i}
									size="small"
									style={{ marginTop: 8 }}
									title={
										<Space>
											<Tag color={meta.color} style={{ color: "#fff" }}>
												{t(meta.key as "decisionYes")}
											</Tag>
											<Text type="secondary" style={{ fontSize: 12 }}>
												{formatDateTime(f.updated_at, i18n.language)}
											</Text>
										</Space>
									}
								>
									{f.positives && (
										<Paragraph
											style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}
										>
											<Text strong>{t("positives")}: </Text>
											{f.positives}
										</Paragraph>
									)}
									{f.negatives && (
										<Paragraph
											style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}
										>
											<Text strong>{t("negatives")}: </Text>
											{f.negatives}
										</Paragraph>
									)}
									{f.overall_assessment && (
										<Paragraph
											style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
										>
											<Text strong>{t("overallAssessment")}: </Text>
											{f.overall_assessment}
										</Paragraph>
									)}
								</Card>
							);
						})
					)}
				</div>
			</div>
		);
	};

	const interviewTypeLabel = (type: InterviewType) =>
		t(`interviewType${capitalize(type)}` as "interviewTypeOther");
	const interviewStateLabel = (state: InterviewState) =>
		t(`interviewState${capitalize(state)}` as "interviewStateScheduled");

	const interviewColumns = [
		{
			title: t("interviewType"),
			dataIndex: "interview_type",
			key: "interview_type",
			render: (type: InterviewType) => interviewTypeLabel(type),
		},
		{
			title: t("when"),
			dataIndex: "starts_at",
			key: "starts_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (state: InterviewState) => (
				<Tag color={INTERVIEW_STATE_COLORS[state]}>
					{interviewStateLabel(state)}
				</Tag>
			),
		},
		{
			title: t("interviewers"),
			dataIndex: "interviewer_count",
			key: "interviewer_count",
		},
		{
			title: t("candidateRsvp"),
			dataIndex: "candidate_rsvp",
			key: "candidate_rsvp",
			render: (rsvp?: "yes" | "no") =>
				rsvp === "yes"
					? t("rsvpYes")
					: rsvp === "no"
						? t("rsvpNo")
						: t("rsvpPending"),
		},
		{
			title: t("feedback"),
			key: "feedback",
			render: (_: unknown, record: OrgInterviewSummary) =>
				t("feedbackCount", {
					submitted: record.feedback_submitted_count,
					total: record.interviewer_count,
				}),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, record: OrgInterviewSummary) => (
				<Link
					to={`/candidacies/${candidacyId}/interviews/${record.interview_id}/feedback`}
				>
					{t("viewInterview")}
				</Link>
			),
		},
	];

	if (loading || !candidacy) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					minHeight: 400,
				}}
			>
				<Spin size="large" />
			</div>
		);
	}

	const isInterviewing = candidacy.state === "interviewing";
	const isTerminal = !["interviewing", "offered"].includes(candidacy.state);

	const overviewItems = [
		{
			key: "candidate",
			label: t("candidate"),
			children: `${candidacy.candidate_display_name} (@${candidacy.candidate_handle})`,
		},
		{
			key: "opening",
			label: t("opening"),
			children: candidacy.opening_title,
		},
		{
			key: "created",
			label: t("created"),
			children: formatDateTime(candidacy.created_at, i18n.language),
		},
		{
			key: "state_changed",
			label: t("stateChanged"),
			children: formatDateTime(candidacy.state_changed_at, i18n.language),
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
				<Link to="/candidacies">
					<Button icon={<ArrowLeftOutlined />}>{t("backToCandidacies")}</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					marginBottom: 20,
				}}
			>
				<div>
					<Title level={2} style={{ margin: 0, marginBottom: 8 }}>
						{candidacy.candidate_display_name ||
							`@${candidacy.candidate_handle}`}
					</Title>
					<Space size={8}>
						<Text type="secondary">{candidacy.opening_title}</Text>
						<Tag color={CANDIDACY_STATE_COLORS[candidacy.state]}>
							{t(candidacy.state)}
						</Tag>
					</Space>
				</div>
				<Link to={`/openings/${candidacy.opening_id}`}>
					<Button>{t("viewOpening")}</Button>
				</Link>
			</div>

			{/* Overview */}
			<Card title={t("overview")} style={{ marginBottom: 16 }}>
				<Descriptions bordered column={2} items={overviewItems} size="small" />
			</Card>

			{/* Interviews */}
			<Card
				title={t("interviews")}
				style={{ marginBottom: 16 }}
				extra={
					canManage &&
					isInterviewing && (
						<Button
							type="primary"
							icon={<CalendarOutlined />}
							onClick={() =>
								navigate(`/candidacies/${candidacyId}/schedule-interview`)
							}
						>
							{t("scheduleInterview")}
						</Button>
					)
				}
			>
				{candidacy.interviews.length === 0 ? (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={t("noInterviews")}
					/>
				) : (
					<Table
						dataSource={candidacy.interviews}
						columns={interviewColumns}
						rowKey="interview_id"
						pagination={false}
						size="small"
						expandable={{
							expandedRowRender: (record: OrgInterviewSummary) =>
								renderInterviewerPanel(record.interview_id),
							onExpand: (expanded: boolean, record: OrgInterviewSummary) => {
								if (
									expanded &&
									interviewDetails[record.interview_id] === undefined
								) {
									fetchInterviewDetail(record.interview_id);
								}
							},
						}}
					/>
				)}
			</Card>

			{/* Offer */}
			<Card
				title={t("offer")}
				style={{ marginBottom: 16 }}
				extra={
					canManage &&
					isInterviewing &&
					!candidacy.offer && (
						<Button
							type="primary"
							icon={<DollarOutlined />}
							onClick={() =>
								navigate(`/candidacies/${candidacyId}/extend-offer`)
							}
						>
							{t("extendOffer")}
						</Button>
					)
				}
			>
				{candidacy.offer ? (
					<>
						<Descriptions
							bordered
							column={2}
							size="small"
							items={[
								...(candidacy.offer.start_date
									? [
											{
												key: "start_date",
												label: t("startDate"),
												children: formatDate(
													candidacy.offer.start_date,
													i18n.language
												),
											},
										]
									: []),
								{
									key: "extended_at",
									label: t("extendedAt"),
									children: formatDateTime(
										candidacy.offer.extended_at,
										i18n.language
									),
								},
								...(candidacy.offer.notes
									? [
											{
												key: "notes",
												label: t("notes"),
												children: candidacy.offer.notes,
												span: 2,
											},
										]
									: []),
							]}
						/>
						{candidacy.offer.offer_letter_download_url && (
							<Button
								type="link"
								icon={<DownloadOutlined />}
								style={{ paddingLeft: 0, marginTop: 12 }}
								href={candidacy.offer.offer_letter_download_url}
								target="_blank"
								rel="noreferrer"
							>
								{t("downloadOfferLetter")}
							</Button>
						)}
					</>
				) : (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={t("noOffer")}
					/>
				)}
			</Card>

			{/* Comments */}
			<Card title={t("comments")}>
				<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
					{t("commentsShared")}
				</Text>
				{candidacy.comments.length === 0 ? (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={t("noComments")}
					/>
				) : (
					<Timeline
						items={candidacy.comments.map((c: CandidacyComment) => ({
							children: (
								<div>
									<Text strong>
										{c.author_kind === "org_user"
											? t("authorOrg")
											: c.author_kind === "hub_user"
												? t("authorHub")
												: t("authorSystem")}
										{c.author_handle ? ` (@${c.author_handle})` : ""}
									</Text>
									<Paragraph
										style={{ whiteSpace: "pre-wrap", marginBottom: 4 }}
									>
										{c.body}
									</Paragraph>
									<Text type="secondary" style={{ fontSize: 12 }}>
										{formatDateTime(c.created_at, i18n.language)}
									</Text>
								</div>
							),
						}))}
					/>
				)}

				{canManage &&
					(isTerminal ? (
						<Text type="secondary">{t("commentsClosed")}</Text>
					) : (
						<div style={{ marginTop: 16 }}>
							<TextArea
								rows={3}
								value={commentText}
								onChange={(e) => setCommentText(e.target.value)}
								placeholder={t("commentPlaceholder")}
								maxLength={4000}
							/>
							<Button
								type="primary"
								style={{ marginTop: 8 }}
								loading={postingComment}
								disabled={!commentText.trim()}
								onClick={handlePostComment}
							>
								{t("submitComment")}
							</Button>
						</div>
					))}
			</Card>
		</div>
	);
};

export default CandidacyDetailPage;
