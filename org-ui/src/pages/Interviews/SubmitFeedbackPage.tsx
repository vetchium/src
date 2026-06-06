import React, { useCallback, useEffect, useState } from "react";
import {
	Alert,
	Button,
	Card,
	Form,
	Input,
	Space,
	Spin,
	Tag,
	Typography,
	message,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	FeedbackDecision,
	InterviewIdRequest,
	MyInterviewFeedback,
	OrgInterview,
	SubmitInterviewFeedbackRequest,
} from "vetchium-specs/org/interviews";
import type { InterviewState } from "vetchium-specs/hub/candidacies";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// Decision options with a strong positive→negative colour scale so the choice
// is unambiguous and a wrong pick stands out (#17).
const DECISIONS: { value: FeedbackDecision; color: string; key: string }[] = [
	{ value: "strong_yes", color: "#237804", key: "strong_yes" },
	{ value: "yes", color: "#52c41a", key: "yes" },
	{ value: "neutral", color: "#8c8c8c", key: "neutral" },
	{ value: "no", color: "#ff4d4f", key: "no" },
	{ value: "strong_no", color: "#a8071a", key: "strong_no" },
];

const INTERVIEW_STATE_COLORS: Record<InterviewState, string> = {
	scheduled: "blue",
	completed: "green",
	cancelled: "default",
};

export const SubmitFeedbackPage: React.FC = () => {
	const { t, i18n } = useTranslation("interviews");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { interviewId, candidacyId } = useParams<{
		interviewId: string;
		candidacyId: string;
	}>();
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [interview, setInterview] = useState<OrgInterview | null>(null);
	const [mine, setMine] = useState<MyInterviewFeedback | null>(null);

	const [decision, setDecision] = useState<FeedbackDecision | null>(null);
	const [positives, setPositives] = useState("");
	const [negatives, setNegatives] = useState("");
	const [overall, setOverall] = useState("");
	const [candidateFeedback, setCandidateFeedback] = useState("");

	const post = useCallback(
		async (path: string, body: unknown): Promise<Response | null> => {
			if (!sessionToken) return null;
			const apiBaseUrl = await getApiBaseUrl();
			return fetch(`${apiBaseUrl}${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
		},
		[sessionToken]
	);

	const load = useCallback(async () => {
		if (!sessionToken || !interviewId) return;
		setLoading(true);
		try {
			const idReq: InterviewIdRequest = { interview_id: interviewId };
			const ivRes = await post("/org/get-interview", idReq);
			if (ivRes && ivRes.status === 200) {
				setInterview((await ivRes.json()) as OrgInterview);
			}
			const myRes = await post("/org/get-my-interview-feedback", idReq);
			if (myRes && myRes.status === 200) {
				const fb = (await myRes.json()) as MyInterviewFeedback;
				setMine(fb);
				setDecision(fb.decision);
				setPositives(fb.positives);
				setNegatives(fb.negatives);
				setOverall(fb.overall_assessment);
				setCandidateFeedback(fb.candidate_feedback ?? "");
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, interviewId, post]);

	useEffect(() => {
		load();
	}, [load]);

	const buildBody = (): SubmitInterviewFeedbackRequest | null => {
		if (!interviewId || !decision) return null;
		return {
			interview_id: interviewId,
			decision,
			positives,
			negatives,
			overall_assessment: overall,
			...(candidateFeedback ? { candidate_feedback: candidateFeedback } : {}),
		};
	};

	const handleSaveDraft = async () => {
		const body = buildBody();
		if (!body) {
			message.error(t("decisionRequired"));
			return;
		}
		setBusy(true);
		try {
			const res = await post("/org/save-interview-feedback", body);
			if (res && res.status === 200) {
				message.success(t("draftSaved"));
				load();
			} else {
				message.error(t("saveFailed"));
			}
		} finally {
			setBusy(false);
		}
	};

	const handleSubmit = async () => {
		const body = buildBody();
		if (!body) {
			message.error(t("decisionRequired"));
			return;
		}
		setBusy(true);
		try {
			const res = await post("/org/submit-interview-feedback", body);
			if (res && res.status === 200) {
				message.success(t("feedbackSubmitted"));
				navigate(`/candidacies/${candidacyId}`);
			} else if (res && res.status === 400) {
				const errs = await res.json();
				if (Array.isArray(errs)) {
					errs.forEach((e: { message: string }) => message.error(e.message));
				}
			} else if (res && res.status === 403) {
				message.error(t("notOnPanel"));
			} else {
				message.error(t("saveFailed"));
			}
		} finally {
			setBusy(false);
		}
	};

	const handleComplete = async () => {
		if (!interviewId) return;
		setBusy(true);
		try {
			const idReq: InterviewIdRequest = { interview_id: interviewId };
			const res = await post("/org/complete-interview", idReq);
			if (res && res.status === 200) {
				message.success(t("completeSuccess"));
				load();
			} else if (res && res.status === 403) {
				message.error(t("notOnPanel"));
			} else {
				message.error(t("completeFailed"));
			}
		} finally {
			setBusy(false);
		}
	};

	const decisionLabel = (d: FeedbackDecision) => t(d);

	if (loading) {
		return (
			<div style={{ padding: "24px 16px", textAlign: "center" }}>
				<Spin size="large" />
			</div>
		);
	}

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 760,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to={`/candidacies/${candidacyId}`}>
					<Button icon={<ArrowLeftOutlined />}>{t("backToCandidacy")}</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 16,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("feedbackTitle")}
				</Title>
				{interview && (
					<Space>
						<Text type="secondary">{t("interviewStateLabel")}:</Text>
						<Tag color={INTERVIEW_STATE_COLORS[interview.state]}>
							{t(interview.state)}
						</Tag>
						{interview.state === "scheduled" && (
							<Button size="small" onClick={handleComplete} loading={busy}>
								{t("markComplete")}
							</Button>
						)}
					</Space>
				)}
			</div>

			{mine?.state === "submitted" && (
				<Alert
					type="info"
					showIcon
					style={{ marginBottom: 16 }}
					title={t("previouslySubmitted", {
						date: mine.submitted_at
							? formatDateTime(mine.submitted_at, i18n.language)
							: "",
					})}
				/>
			)}
			{mine?.state === "draft" && (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 16 }}
					title={t("draftNotice")}
				/>
			)}

			<Spin spinning={busy}>
				<Form layout="vertical">
					<Form.Item label={t("decision")} required help={t("decisionHelp")}>
						<Space wrap>
							{DECISIONS.map((d) => {
								const active = decision === d.value;
								return (
									<Button
										key={d.value}
										onClick={() => setDecision(d.value)}
										style={{
											background: active ? d.color : undefined,
											borderColor: d.color,
											color: active ? "#fff" : d.color,
											fontWeight: active ? 600 : 400,
										}}
									>
										{decisionLabel(d.value)}
									</Button>
								);
							})}
						</Space>
					</Form.Item>

					<Form.Item label={t("positives")}>
						<TextArea
							rows={4}
							maxLength={4000}
							showCount
							value={positives}
							onChange={(e) => setPositives(e.target.value)}
						/>
					</Form.Item>

					<Form.Item label={t("negatives")}>
						<TextArea
							rows={4}
							maxLength={4000}
							showCount
							value={negatives}
							onChange={(e) => setNegatives(e.target.value)}
						/>
					</Form.Item>

					<Form.Item label={t("overallAssessment")}>
						<TextArea
							rows={4}
							maxLength={4000}
							showCount
							value={overall}
							onChange={(e) => setOverall(e.target.value)}
						/>
					</Form.Item>

					<Form.Item label={t("candidateFeedback")}>
						<TextArea
							rows={3}
							maxLength={2000}
							showCount
							value={candidateFeedback}
							onChange={(e) => setCandidateFeedback(e.target.value)}
						/>
					</Form.Item>

					<Space>
						<Button onClick={handleSaveDraft} loading={busy}>
							{t("saveDraft")}
						</Button>
						<Button type="primary" onClick={handleSubmit} loading={busy}>
							{t("submitFeedback")}
						</Button>
					</Space>
				</Form>
			</Spin>

			{/* Submitted feedback from the whole panel, read-only (#18). */}
			{interview && interview.feedback.length > 0 && (
				<Card title={t("otherFeedback")} style={{ marginTop: 24 }}>
					{interview.feedback.map((f, i) => {
						const dec = DECISIONS.find((d) => d.value === f.decision);
						return (
							<div
								key={i}
								style={{
									marginBottom: 12,
									paddingBottom: 12,
									borderBottom: "1px solid #f0f0f0",
								}}
							>
								<Space>
									<Tag color={dec?.color} style={{ color: "#fff" }}>
										{decisionLabel(f.decision)}
									</Tag>
									<Text type="secondary" style={{ fontSize: 12 }}>
										{formatDateTime(f.updated_at, i18n.language)}
									</Text>
								</Space>
								{f.overall_assessment && (
									<Paragraph
										style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}
									>
										{f.overall_assessment}
									</Paragraph>
								)}
							</div>
						);
					})}
				</Card>
			)}
		</div>
	);
};
