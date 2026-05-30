import React, { useCallback, useEffect, useState } from "react";
import {
	Button,
	Card,
	Col,
	Descriptions,
	Empty,
	Modal,
	Row,
	Space,
	Spin,
	Tag,
	Typography,
	message,
} from "antd";
import {
	ArrowLeftOutlined,
	DownloadOutlined,
	ExclamationCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	ApplicationState,
	GetMyApplicationRequest,
	HubApplication,
	MyEndorsementOnApplication,
	MyEndorsementRequestSent,
	WithdrawApplicationRequest,
} from "vetchium-specs/hub/applications";
import type {
	HideEndorsementOnApplicationRequest,
	ShowEndorsementOnApplicationRequest,
} from "vetchium-specs/hub/endorsements";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text, Paragraph } = Typography;

const STATE_COLORS: Record<ApplicationState, string> = {
	applied: "blue",
	shortlisted: "green",
	rejected: "red",
	withdrawn: "default",
	expired: "default",
};

const REQUEST_STATE_COLORS: Record<MyEndorsementRequestSent["state"], string> =
	{
		pending: "blue",
		written: "green",
		declined: "default",
		expired: "default",
	};

export const MyApplicationDetailPage: React.FC = () => {
	const { t, i18n } = useTranslation("applications");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { applicationId } = useParams<{ applicationId: string }>();
	const [application, setApplication] = useState<HubApplication | null>(null);
	const [loading, setLoading] = useState(false);

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
			const req: GetMyApplicationRequest = { application_id: applicationId };
			const res = await fetch(`${apiBaseUrl}/hub/get-my-application`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				setApplication((await res.json()) as HubApplication);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, applicationId]);

	useEffect(() => {
		fetchApplication();
	}, [fetchApplication]);

	const handleToggleEndorsement = async (
		endorsementId: string,
		hidden: boolean
	) => {
		const body:
			| HideEndorsementOnApplicationRequest
			| ShowEndorsementOnApplicationRequest = {
			endorsement_id: endorsementId,
		};
		const path = hidden
			? "/hub/show-endorsement-on-application"
			: "/hub/hide-endorsement-on-application";
		const status = await post(path, body);
		if (status === 204) fetchApplication();
	};

	const handleWithdraw = () => {
		if (!applicationId) return;
		Modal.confirm({
			title: t("withdraw"),
			icon: <ExclamationCircleOutlined />,
			content: t("withdrawConfirm"),
			okText: t("withdraw"),
			okButtonProps: { danger: true },
			onOk: async () => {
				const body: WithdrawApplicationRequest = {
					application_id: applicationId,
				};
				const status = await post("/hub/withdraw-application", body);
				if (status === 200 || status === 204) {
					message.success(t("withdrawSuccess"));
					fetchApplication();
				} else {
					message.error(t("withdrawFailed"));
				}
			},
		});
	};

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
				<Link to="/my-applications">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<Spin spinning={loading}>
				{application ? (
					<>
						<div style={{ marginBottom: 16 }}>
							<Title level={2} style={{ margin: 0, marginBottom: 4 }}>
								{application.opening_title}
							</Title>
							<Text type="secondary" style={{ fontSize: 16 }}>
								{application.org_name || application.org_domain}
							</Text>
							<div style={{ marginTop: 8 }}>
								<Tag color={STATE_COLORS[application.state] ?? "default"}>
									{t(application.state)}
								</Tag>
							</div>
						</div>

						<Row gutter={[24, 24]}>
							<Col xs={24} md={16}>
								<Card title={t("coverLetter")} style={{ marginBottom: 16 }}>
									<Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>
										{application.cover_letter}
									</Paragraph>
								</Card>

								<Card
									title={t("endorsementsReceived")}
									style={{ marginBottom: 16 }}
								>
									{application.endorsements.length === 0 ? (
										<Empty
											image={Empty.PRESENTED_IMAGE_SIMPLE}
											description={t("noEndorsements")}
										/>
									) : (
										application.endorsements.map(
											(e: MyEndorsementOnApplication) => (
												<div
													key={e.endorsement_id}
													style={{
														marginBottom: 12,
														paddingBottom: 12,
														borderBottom: "1px solid #f0f0f0",
													}}
												>
													<div
														style={{
															display: "flex",
															justifyContent: "space-between",
															alignItems: "flex-start",
															gap: 8,
														}}
													>
														<Space size={[4, 4]} wrap>
															<Text strong>
																{e.endorser_display_name} (@
																{e.endorser_handle})
															</Text>
															{e.is_referral && (
																<Tag color="purple">{t("referral")}</Tag>
															)}
															{e.is_unsolicited && (
																<Tag color="blue">{t("unsolicited")}</Tag>
															)}
															{e.hidden_by_candidate && (
																<Tag>{t("hidden")}</Tag>
															)}
														</Space>
														<Button
															size="small"
															onClick={() =>
																handleToggleEndorsement(
																	e.endorsement_id,
																	e.hidden_by_candidate
																)
															}
														>
															{e.hidden_by_candidate ? t("show") : t("hide")}
														</Button>
													</div>
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
											)
										)
									)}
								</Card>

								{application.endorsement_requests.length > 0 && (
									<Card title={t("endorsementsRequested")}>
										{application.endorsement_requests.map(
											(r: MyEndorsementRequestSent) => (
												<div
													key={r.request_id}
													style={{
														display: "flex",
														alignItems: "center",
														gap: 8,
														marginBottom: 8,
													}}
												>
													<Text>
														{r.endorser_display_name} (@{r.endorser_handle})
													</Text>
													<Tag color={REQUEST_STATE_COLORS[r.state]}>
														{t(r.state)}
													</Tag>
												</div>
											)
										)}
									</Card>
								)}
							</Col>

							<Col xs={24} md={8}>
								<Card style={{ marginBottom: 16 }}>
									<Descriptions column={1} size="small">
										<Descriptions.Item label={t("status")}>
											<Tag color={STATE_COLORS[application.state] ?? "default"}>
												{t(application.state)}
											</Tag>
										</Descriptions.Item>
										<Descriptions.Item label={t("appliedDate")}>
											{formatDateTime(application.applied_at, i18n.language)}
										</Descriptions.Item>
										{application.ai_score !== undefined && (
											<Descriptions.Item label={t("aiScore")}>
												{application.ai_score.toFixed(2)}
											</Descriptions.Item>
										)}
									</Descriptions>

									<Button
										block
										style={{ marginTop: 12 }}
										onClick={() =>
											navigate(
												`/org/${application.org_domain}/openings/${application.opening_number}`
											)
										}
									>
										{t("viewOpening")}
									</Button>

									{application.resume_download_url && (
										<Button
											block
											icon={<DownloadOutlined />}
											style={{ marginTop: 8 }}
											href={application.resume_download_url}
											target="_blank"
											rel="noreferrer"
										>
											{t("resume")}
										</Button>
									)}

									{application.state === "applied" && (
										<Button
											block
											danger
											style={{ marginTop: 8 }}
											onClick={handleWithdraw}
										>
											{t("withdraw")}
										</Button>
									)}
								</Card>

								{application.candidacy_id && (
									<Card>
										<Link to={`/my-candidacies/${application.candidacy_id}`}>
											<Button type="primary" block>
												{t("openCandidacy")}
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
