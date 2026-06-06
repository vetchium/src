import React, { useCallback, useEffect, useState } from "react";
import {
	Button,
	Card,
	Form,
	Input,
	Spin,
	Tag,
	Timeline,
	Typography,
	message,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import type {
	HubCandidacy,
	HubInterview,
	CandidacyComment,
	GetMyCandidacyRequest,
	AddCandidacyCommentRequest,
	RSVPInterviewRequest,
} from "vetchium-specs/hub/candidacies";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text } = Typography;
const { TextArea } = Input;

const INTERVIEW_STATE_COLORS: Record<string, string> = {
	scheduled: "blue",
	completed: "green",
	cancelled: "default",
};

export const MyCandidacyDetailPage: React.FC = () => {
	const { t, i18n } = useTranslation("candidacies");
	const { sessionToken } = useAuth();
	const { candidacyId } = useParams<{ candidacyId: string }>();
	const [candidacy, setCandidacy] = useState<HubCandidacy | null>(null);
	const [loading, setLoading] = useState(false);
	const [commentText, setCommentText] = useState("");
	const [postingComment, setPostingComment] = useState(false);
	const [rsvpLoading, setRsvpLoading] = useState<string | null>(null);

	const fetchCandidacy = useCallback(async () => {
		if (!sessionToken || !candidacyId) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: GetMyCandidacyRequest = { candidacy_id: candidacyId };
			const res = await fetch(`${apiBaseUrl}/hub/get-my-candidacy`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				setCandidacy(await res.json());
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, candidacyId]);

	useEffect(() => {
		fetchCandidacy();
	}, [fetchCandidacy]);

	const handleRSVP = async (interviewId: string, rsvp: "yes" | "no") => {
		if (!sessionToken) return;
		setRsvpLoading(interviewId);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: RSVPInterviewRequest = { interview_id: interviewId, rsvp };
			const res = await fetch(`${apiBaseUrl}/hub/rsvp-interview`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				fetchCandidacy();
			} else {
				message.error("Failed to RSVP");
			}
		} finally {
			setRsvpLoading(null);
		}
	};

	const handlePostComment = async () => {
		if (!sessionToken || !candidacyId || !commentText.trim()) return;
		setPostingComment(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: AddCandidacyCommentRequest = {
				candidacy_id: candidacyId,
				body: commentText.trim(),
			};
			const res = await fetch(`${apiBaseUrl}/hub/add-candidacy-comment`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				setCommentText("");
				fetchCandidacy();
			} else {
				message.error("Failed to post comment");
			}
		} finally {
			setPostingComment(false);
		}
	};

	const isTerminalState =
		candidacy && !["interviewing", "offered"].includes(candidacy.state);

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 1000,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to="/my-candidacies">
					<Button icon={<ArrowLeftOutlined />}>{t("backToCandidacies")}</Button>
				</Link>
			</div>

			<Spin spinning={loading}>
				{candidacy && (
					<>
						<div style={{ marginBottom: 24 }}>
							<Title level={2} style={{ margin: 0 }}>
								{candidacy.opening_title}
							</Title>
							<Text type="secondary">
								{candidacy.org_name || candidacy.org_domain}
							</Text>
							<div style={{ marginTop: 8 }}>
								<Tag color={candidacy.state === "offered" ? "green" : "blue"}>
									{t(candidacy.state as "interviewing")}
								</Tag>
							</div>
							<div style={{ marginTop: 8 }}>
								<Link
									to={`/org/${candidacy.org_domain}/openings/${candidacy.opening_number}`}
								>
									{t("viewOpening")}
								</Link>
							</div>
						</div>

						{/* Interviews */}
						<Card title={t("interviews")} style={{ marginBottom: 16 }}>
							{candidacy.interviews.length === 0 ? (
								<Text type="secondary">{t("noInterviews")}</Text>
							) : (
								candidacy.interviews.map((iv: HubInterview) => (
									<Card
										key={iv.interview_id}
										size="small"
										style={{ marginBottom: 8 }}
									>
										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												alignItems: "center",
											}}
										>
											<div>
												<Tag
													color={INTERVIEW_STATE_COLORS[iv.state] ?? "default"}
												>
													{t(iv.state as "scheduled")}
												</Tag>
												<Text>
													{iv.interview_type.replace("_", " ")} —{" "}
													{formatDateTime(iv.starts_at, i18n.language)}
												</Text>
												{iv.description && (
													<div>
														<Text type="secondary">{iv.description}</Text>
													</div>
												)}
												{iv.interview_location && (
													<div>
														<Text type="secondary">
															📍 {iv.interview_location}
														</Text>
													</div>
												)}
											</div>
											{iv.state === "scheduled" && (
												<div style={{ display: "flex", gap: 8 }}>
													<Button
														size="small"
														type={
															iv.candidate_rsvp === "yes"
																? "primary"
																: "default"
														}
														loading={rsvpLoading === iv.interview_id}
														onClick={() => handleRSVP(iv.interview_id, "yes")}
													>
														{t("rsvpYes")}
													</Button>
													<Button
														size="small"
														danger={iv.candidate_rsvp === "no"}
														loading={rsvpLoading === iv.interview_id}
														onClick={() => handleRSVP(iv.interview_id, "no")}
													>
														{t("rsvpNo")}
													</Button>
												</div>
											)}
										</div>
									</Card>
								))
							)}
						</Card>

						{/* Offer panel */}
						{candidacy.offer && (
							<Card title={t("offer")} style={{ marginBottom: 16 }}>
								{candidacy.offer.salary_currency &&
									candidacy.offer.salary_amount && (
										<div>
											{t("salary")}: {candidacy.offer.salary_currency}{" "}
											{candidacy.offer.salary_amount}
										</div>
									)}
								{candidacy.offer.start_date && (
									<div>
										{t("startDate")}: {candidacy.offer.start_date}
									</div>
								)}
							</Card>
						)}

						{/* Comments */}
						<Card title={t("comments")} style={{ marginBottom: 16 }}>
							<Text
								type="secondary"
								style={{ display: "block", marginBottom: 12 }}
							>
								{t("commentsShared")}
							</Text>
							<Timeline
								items={candidacy.comments.map((c: CandidacyComment) => ({
									children: (
										<div>
											<Text strong>
												{c.author_kind === "hub_user"
													? t("you")
													: c.author_kind === "org_user"
														? t("authorOrg")
														: t("authorSystem")}
											</Text>
											<div>{c.body}</div>
											<Text type="secondary" style={{ fontSize: 12 }}>
												{formatDateTime(c.created_at, i18n.language)}
											</Text>
										</div>
									),
								}))}
							/>
							{!isTerminalState && (
								<Form.Item style={{ marginTop: 16 }}>
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
								</Form.Item>
							)}
						</Card>
					</>
				)}
			</Spin>
		</div>
	);
};
