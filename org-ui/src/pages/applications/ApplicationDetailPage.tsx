import React, { useCallback, useEffect, useState } from "react";
import {
	Button,
	Card,
	Col,
	Descriptions,
	Empty,
	Row,
	Space,
	Spin,
	Tag,
	Typography,
	message,
} from "antd";
import {
	ApartmentOutlined,
	ArrowLeftOutlined,
	DownloadOutlined,
	ExpandOutlined,
	ExportOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import type {
	LabelApplicationRequest,
	OrgApplication,
	OrgVisibleEndorsement,
	ShortlistApplicationRequest,
	RejectApplicationRequest,
} from "vetchium-specs/org/applications";
import type {
	ApplicationColorLabel,
	ApplicationState,
} from "vetchium-specs/hub/applications";
import type { PublicEmployerStint } from "vetchium-specs/hub/work-emails";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text, Paragraph } = Typography;

const STATE_COLORS: Record<ApplicationState, string> = {
	applied: "blue",
	shortlisted: "green",
	rejected: "red",
	withdrawn: "default",
	expired: "default",
};

const LABEL_OPTIONS: { value: "" | ApplicationColorLabel; key: string }[] = [
	{ value: "", key: "labelNone" },
	{ value: "green", key: "labelGreen" },
	{ value: "yellow", key: "labelYellow" },
	{ value: "red", key: "labelRed" },
];

// Actual swatch colors so the label control conveys the colour, not just text.
const LABEL_SWATCH: Record<ApplicationColorLabel, string> = {
	green: "#52c41a",
	yellow: "#faad14",
	red: "#f5222d",
};

export const ApplicationDetailPage: React.FC = () => {
	const { t, i18n } = useTranslation("applications");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { applicationId, openingId } = useParams<{
		applicationId: string;
		openingId: string;
	}>();
	const [application, setApplication] = useState<OrgApplication | null>(null);
	const [loading, setLoading] = useState(false);
	const [actioning, setActioning] = useState(false);
	const [resumeLoading, setResumeLoading] = useState(false);
	// Object URL for the fetched resume blob, used both for the inline thumbnail
	// preview and for opening the full document in a new tab.
	const [resumeUrl, setResumeUrl] = useState<string | null>(null);

	const post = useCallback(
		async (path: string, body: unknown): Promise<number> => {
			if (!sessionToken) return 401;
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			return res.status;
		},
		[sessionToken]
	);

	const fetchApplication = useCallback(async () => {
		if (!sessionToken || !applicationId) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/org/get-application`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ application_id: applicationId }),
			});
			if (res.status === 200) {
				setApplication((await res.json()) as OrgApplication);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, applicationId]);

	useEffect(() => {
		fetchApplication();
	}, [fetchApplication]);

	// The resume route is auth-gated, so a plain href can't fetch it. Pull it
	// with the bearer token once and wrap it in an object URL we can reuse for
	// both the inline thumbnail preview and opening it full-size in a new tab.
	const resumeDownloadUrl = application?.resume_download_url;
	useEffect(() => {
		if (!sessionToken || !resumeDownloadUrl) {
			setResumeUrl(null);
			return;
		}
		let objectUrl: string | null = null;
		let cancelled = false;
		setResumeLoading(true);
		(async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const res = await fetch(`${apiBaseUrl}${resumeDownloadUrl}`, {
					headers: { Authorization: `Bearer ${sessionToken}` },
				});
				if (cancelled) return;
				if (res.ok) {
					const blob = await res.blob();
					if (cancelled) return;
					objectUrl = URL.createObjectURL(blob);
					setResumeUrl(objectUrl);
				} else {
					message.error(t("actionFailed"));
				}
			} finally {
				if (!cancelled) setResumeLoading(false);
			}
		})();
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [sessionToken, resumeDownloadUrl, t]);

	const openResume = useCallback(() => {
		if (resumeUrl) window.open(resumeUrl, "_blank", "noopener,noreferrer");
	}, [resumeUrl]);

	const handleShortlist = async () => {
		if (!applicationId) return;
		setActioning(true);
		try {
			const body: ShortlistApplicationRequest = {
				application_id: applicationId,
			};
			const status = await post("/org/shortlist-application", body);
			if (status === 200) {
				message.success(t("shortlistSuccess"));
				fetchApplication();
			} else {
				message.error(t("actionFailed"));
			}
		} finally {
			setActioning(false);
		}
	};

	const handleReject = async () => {
		if (!applicationId) return;
		setActioning(true);
		try {
			const body: RejectApplicationRequest = { application_id: applicationId };
			const status = await post("/org/reject-application", body);
			if (status === 200) {
				message.success(t("rejectSuccess"));
				fetchApplication();
			} else {
				message.error(t("actionFailed"));
			}
		} finally {
			setActioning(false);
		}
	};

	const handleLabel = async (value: "" | ApplicationColorLabel) => {
		if (!applicationId) return;
		setActioning(true);
		try {
			const body: LabelApplicationRequest = {
				application_id: applicationId,
				...(value ? { label: value } : {}),
			};
			const status = await post("/org/label-application", body);
			if (status === 200) {
				message.success(t("labelUpdated"));
				fetchApplication();
			} else {
				message.error(t("actionFailed"));
			}
		} finally {
			setActioning(false);
		}
	};

	// Defence-in-depth: only offer shortlist/reject/label to users who can actually
	// perform them (the backend independently enforces org:manage_applications → 403).
	const canManageApplications =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_applications") ||
		false;
	const canAct = application?.state === "applied" && canManageApplications;

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
				<Link to={openingId ? `/openings/${openingId}/applications` : "/"}>
					<Button icon={<ArrowLeftOutlined />}>
						{t("backToApplications")}
					</Button>
				</Link>
			</div>

			<Spin spinning={loading}>
				{application ? (
					<>
						<div style={{ marginBottom: 16 }}>
							<Title level={2} style={{ margin: 0, marginBottom: 8 }}>
								{application.candidate_display_name ||
									application.candidate_handle}{" "}
								<Text
									type="secondary"
									style={{ fontSize: 16, fontWeight: "normal" }}
								>
									(@{application.candidate_handle})
								</Text>{" "}
								<Link
									to={`/u/${application.candidate_handle}`}
									target="_blank"
									rel="noreferrer"
									title={t("viewProfile")}
									aria-label={t("viewProfile")}
								>
									<ExportOutlined style={{ fontSize: 18 }} />
								</Link>
							</Title>
							<Space size={8} wrap>
								<Tag color={STATE_COLORS[application.state] ?? "default"}>
									{t(application.state)}
								</Tag>
								{application.referring_agency_domain && (
									<Tag color="geekblue" icon={<ApartmentOutlined />}>
										{t("viaAgency", {
											agency: application.referring_agency_domain,
										})}
									</Tag>
								)}
								{application.candidate_employer_stints.map(
									(stint: PublicEmployerStint, i) => (
										<Tag key={i}>
											{stint.domain} {stint.start_year}–
											{stint.is_current
												? t("present")
												: (stint.end_year ?? t("present"))}
										</Tag>
									)
								)}
							</Space>
						</div>

						<Row gutter={[24, 24]}>
							<Col xs={24} md={16}>
								{application.candidate_short_bio && (
									<Card title={t("shortBio")} style={{ marginBottom: 16 }}>
										<Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>
											{application.candidate_short_bio}
										</Paragraph>
									</Card>
								)}

								<Card title={t("coverLetter")} style={{ marginBottom: 16 }}>
									<Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>
										{application.cover_letter}
									</Paragraph>
								</Card>

								{application.resume_download_url && (
									<Card title={t("resume")} style={{ marginBottom: 16 }}>
										<Spin spinning={resumeLoading}>
											{resumeUrl ? (
												<div
													role="button"
													tabIndex={0}
													onClick={openResume}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															openResume();
														}
													}}
													title={t("openResumeNewTab")}
													style={{
														position: "relative",
														width: 200,
														height: 260,
														border: "1px solid #f0f0f0",
														borderRadius: 4,
														overflow: "hidden",
														cursor: "pointer",
													}}
												>
													<iframe
														src={`${resumeUrl}#toolbar=0&navpanes=0&view=FitH`}
														title={t("resume")}
														style={{
															width: 400,
															height: 520,
															border: "none",
															transform: "scale(0.5)",
															transformOrigin: "top left",
															pointerEvents: "none",
														}}
													/>
													{/* Overlay captures the click (the iframe ignores
													    pointer events) and surfaces the open hint. */}
													<div
														style={{
															position: "absolute",
															inset: 0,
															display: "flex",
															alignItems: "flex-end",
															justifyContent: "center",
															background:
																"linear-gradient(to bottom, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)",
														}}
													>
														<span
															style={{
																color: "#fff",
																padding: "6px 8px",
																fontSize: 12,
															}}
														>
															<ExpandOutlined /> {t("openResumeNewTab")}
														</span>
													</div>
												</div>
											) : (
												<div style={{ minHeight: 60 }} />
											)}
										</Spin>
										<div style={{ marginTop: 12 }}>
											<Button
												icon={<DownloadOutlined />}
												disabled={!resumeUrl}
												onClick={openResume}
											>
												{t("openResumeNewTab")}
											</Button>
										</div>
									</Card>
								)}

								<Card title={t("endorsements")}>
									{application.endorsements.length === 0 ? (
										<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
									) : (
										application.endorsements.map((e: OrgVisibleEndorsement) => (
											<div
												key={e.endorsement_id}
												style={{
													marginBottom: 12,
													paddingBottom: 12,
													borderBottom: "1px solid #f0f0f0",
												}}
											>
												<Space size={[4, 4]} wrap>
													<Text strong>
														{e.endorser_display_name} (@{e.endorser_handle})
													</Text>
													{e.is_referral && (
														<Tag color="purple">{t("referral")}</Tag>
													)}
													{e.is_unsolicited && (
														<Tag color="blue">{t("unsolicited")}</Tag>
													)}
													{e.endorser_is_current_employee && (
														<Tag color="green">{t("currentEmployee")}</Tag>
													)}
													{(e.current_connection_state === "i_disconnected" ||
														e.current_connection_state ===
															"they_disconnected") && (
														<Tag color="orange">{t("noLongerConnected")}</Tag>
													)}
												</Space>
												<div style={{ color: "#888", fontSize: 12 }}>
													{e.shared_domain} {e.overlap_start_year}–
													{e.overlap_end_year}
												</div>
												{e.text && (
													<Paragraph
														style={{
															marginTop: 4,
															marginBottom: 0,
															whiteSpace: "pre-wrap",
														}}
													>
														{e.text}
													</Paragraph>
												)}
											</div>
										))
									)}
								</Card>
							</Col>

							<Col xs={24} md={8}>
								<Card title={t("applicationMeta")} style={{ marginBottom: 16 }}>
									<Descriptions column={1} size="small">
										<Descriptions.Item label={t("appliedDate")}>
											{formatDateTime(application.applied_at, i18n.language)}
										</Descriptions.Item>
										{application.ai_score !== undefined && (
											<Descriptions.Item label={t("aiScore")}>
												{application.ai_score.toFixed(2)}
											</Descriptions.Item>
										)}
									</Descriptions>

									<div style={{ marginTop: 12 }}>
										<Text
											type="secondary"
											style={{ display: "block", marginBottom: 8 }}
										>
											{t("label")}
										</Text>
										<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
											{LABEL_OPTIONS.map((o) => {
												const active = (application.label ?? "") === o.value;
												return (
													<Button
														key={o.key}
														size="small"
														type={active ? "primary" : "default"}
														disabled={actioning || !canAct}
														onClick={() => handleLabel(o.value)}
													>
														{o.value && (
															<span
																style={{
																	display: "inline-block",
																	width: 10,
																	height: 10,
																	borderRadius: "50%",
																	background: LABEL_SWATCH[o.value],
																	marginRight: 6,
																	verticalAlign: "middle",
																}}
															/>
														)}
														{t(o.key as "labelNone")}
													</Button>
												);
											})}
										</div>
									</div>
								</Card>

								{canAct && (
									<Card>
										<Button
											type="primary"
											block
											loading={actioning}
											onClick={handleShortlist}
											style={{ marginBottom: 8 }}
										>
											{t("shortlist")}
										</Button>
										<Button
											danger
											block
											loading={actioning}
											onClick={handleReject}
										>
											{t("reject")}
										</Button>
									</Card>
								)}

								{application.state === "shortlisted" && (
									<Card>
										<Link to="/candidacies">
											<Button type="primary" block>
												{t("viewCandidacy")}
											</Button>
										</Link>
									</Card>
								)}
							</Col>
						</Row>
					</>
				) : (
					!loading && <Empty description={t("notFound")} />
				)}
			</Spin>
		</div>
	);
};

export default ApplicationDetailPage;
