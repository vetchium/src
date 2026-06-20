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
								<Link
									to={`/u/${application.candidate_handle}`}
									target="_blank"
									rel="noreferrer"
									style={{ color: "inherit" }}
								>
									{application.candidate_display_name ||
										application.candidate_handle}
								</Link>{" "}
								<Link
									to={`/u/${application.candidate_handle}`}
									target="_blank"
									rel="noreferrer"
									style={{ fontSize: 16, fontWeight: "normal" }}
								>
									(@{application.candidate_handle})
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
								<Card style={{ marginBottom: 16 }}>
									<Link
										to={`/u/${application.candidate_handle}`}
										target="_blank"
										rel="noreferrer"
									>
										<Button block>{t("viewProfile")}</Button>
									</Link>
								</Card>

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

									{application.resume_download_url && (
										<Button
											block
											icon={<DownloadOutlined />}
											style={{ marginTop: 16 }}
											href={application.resume_download_url}
											target="_blank"
											rel="noreferrer"
										>
											{t("resume")}
										</Button>
									)}
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
