import React, { useCallback, useEffect, useState } from "react";
import {
	Alert,
	Button,
	Card,
	Select,
	Space,
	Table,
	Tag,
	Typography,
	App as AntApp,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import type {
	AgencyRecruiterRef,
	AgencyReferral,
	AgencyReferralState,
	AssignedOpening,
	AssignOpeningRecruitersRequest,
	GetAssignedOpeningResponse,
	ListAgencyRecruitersResponse,
	ListAgencyReferralsResponse,
	RemoveOpeningRecruiterRequest,
} from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDate, formatDateTime } from "../../utils/dateFormat";
import ReferCandidateModal from "./ReferCandidateModal";

const { Title, Text } = Typography;

const stateColors: Record<AgencyReferralState, string> = {
	pending: "orange",
	accepted_applied: "green",
	declined: "red",
	expired: "default",
	not_selected: "default",
};

const OpeningDetailPage: React.FC = () => {
	const { t, i18n } = useTranslation("agencyReferrals");
	const { openingId } = useParams<{ openingId: string }>();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = AntApp.useApp();

	const isLead =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_agency_recruiters") ||
		false;

	const [opening, setOpening] = useState<AssignedOpening | null>(null);
	const [referrals, setReferrals] = useState<AgencyReferral[]>([]);
	const [recruiters, setRecruiters] = useState<AgencyRecruiterRef[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<
		"forbidden" | "notfound" | "generic" | null
	>(null);
	const [modalOpen, setModalOpen] = useState(false);

	const fetchAll = useCallback(async () => {
		if (!sessionToken || !openingId) return;
		setLoading(true);
		setError(null);
		try {
			const baseUrl = await getApiBaseUrl();
			const oRes = await fetch(`${baseUrl}/org/get-assigned-opening`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ opening_id: openingId }),
			});
			if (oRes.status === 403) {
				setError("forbidden");
				return;
			}
			if (oRes.status === 404) {
				setError("notfound");
				return;
			}
			if (oRes.status !== 200) {
				setError("generic");
				return;
			}
			const oData: GetAssignedOpeningResponse = await oRes.json();
			setOpening(oData.opening);

			const rRes = await fetch(`${baseUrl}/org/list-agency-referrals`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ filter_opening_id: openingId, limit: 100 }),
			});
			if (rRes.status === 200) {
				const rData: ListAgencyReferralsResponse = await rRes.json();
				setReferrals(rData.referrals ?? []);
			}
		} catch {
			setError("generic");
		} finally {
			setLoading(false);
		}
	}, [sessionToken, openingId]);

	const fetchRecruiters = useCallback(async () => {
		if (!sessionToken || !isLead) return;
		try {
			const baseUrl = await getApiBaseUrl();
			const res = await fetch(`${baseUrl}/org/list-agency-recruiters`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({}),
			});
			if (res.status === 200) {
				const data: ListAgencyRecruitersResponse = await res.json();
				setRecruiters(data.recruiters ?? []);
			}
		} catch {
			// non-fatal
		}
	}, [sessionToken, isLead]);

	useEffect(() => {
		fetchAll();
	}, [fetchAll]);

	useEffect(() => {
		fetchRecruiters();
	}, [fetchRecruiters]);

	const updateRecruiters = useCallback(
		async (nextIds: string[]) => {
			if (!sessionToken || !opening) return;
			const prevIds = opening.recruiters_are_default
				? []
				: opening.recruiters.map((r) => r.org_user_id);
			const added = nextIds.filter((id) => !prevIds.includes(id));
			const removed = prevIds.filter((id) => !nextIds.includes(id));
			try {
				const baseUrl = await getApiBaseUrl();
				if (added.length > 0) {
					const req: AssignOpeningRecruitersRequest = {
						opening_id: opening.opening_id,
						consumer_org_domain: opening.consumer_org_domain,
						agency_org_user_ids: added,
					};
					await fetch(`${baseUrl}/org/assign-opening-recruiters`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(req),
					});
				}
				for (const id of removed) {
					const req: RemoveOpeningRecruiterRequest = {
						opening_id: opening.opening_id,
						agency_org_user_id: id,
					};
					await fetch(`${baseUrl}/org/remove-opening-recruiter`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(req),
					});
				}
				message.success(t("recruitersUpdated"));
				fetchAll();
			} catch {
				message.error(t("loadError"));
			}
		},
		[sessionToken, opening, message, t, fetchAll]
	);

	const columns = [
		{ title: t("candidate"), dataIndex: "candidate_handle", key: "candidate" },
		{ title: t("statement"), dataIndex: "statement_text", key: "statement" },
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (s: AgencyReferralState) => (
				<Tag color={stateColors[s]}>{t(s)}</Tag>
			),
		},
		{
			title: t("referredBy"),
			dataIndex: "referred_by_name",
			key: "referred_by",
		},
		{
			title: t("referredAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("expires"),
			dataIndex: "expires_at",
			key: "expires_at",
			render: (v: string) => formatDate(v, i18n.language),
		},
	];

	const backButton = (
		<div style={{ marginBottom: 16 }}>
			<Link to="/referrals">
				<Button icon={<ArrowLeftOutlined />}>{t("backToWorkspace")}</Button>
			</Link>
		</div>
	);

	const wrap = (children: React.ReactNode) => (
		<div
			style={{
				width: "100%",
				maxWidth: 1200,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			{backButton}
			{children}
		</div>
	);

	if (error === "forbidden") {
		return wrap(<Alert type="error" showIcon title={t("accessDenied")} />);
	}
	if (error === "notfound") {
		return wrap(<Alert type="error" showIcon title={t("loadError")} />);
	}

	const recruiterOptions = recruiters.map((r) => ({
		value: r.org_user_id,
		label: r.name || r.email,
	}));

	return wrap(
		<>
			{error === "generic" && (
				<Alert
					type="error"
					showIcon
					title={t("loadError")}
					style={{ marginBottom: 16 }}
				/>
			)}
			{opening && (
				<>
					<Title level={2} style={{ marginBottom: 4 }}>
						{opening.title} — {opening.consumer_org_domain} #
						{opening.opening_number}
					</Title>
					<Text type="secondary">
						{t("assignedOn", {
							date: formatDate(opening.assigned_at, i18n.language),
						})}
					</Text>

					<Card
						title={t("recruitersTitle")}
						style={{ marginTop: 24, marginBottom: 24 }}
					>
						{isLead ? (
							<Select
								mode="multiple"
								style={{ minWidth: 280, width: "100%", maxWidth: 480 }}
								placeholder={t("assignRecruiters")}
								options={recruiterOptions}
								value={
									opening.recruiters_are_default
										? []
										: opening.recruiters.map((r) => r.org_user_id)
								}
								onChange={updateRecruiters}
							/>
						) : opening.recruiters.length > 0 ? (
							<Space size={[0, 4]} wrap>
								{opening.recruiters.map((r) => (
									<Tag key={r.org_user_id}>{r.name || r.email}</Tag>
								))}
							</Space>
						) : (
							<Text type="secondary">{t("noRecruiters")}</Text>
						)}
						{opening.recruiters_are_default &&
							opening.recruiters.length > 0 && (
								<div style={{ marginTop: 8 }}>
									<Tag color="blue">{t("defaultBadge")}</Tag>
									{opening.recruiters.map((r) => (
										<Tag key={r.org_user_id}>{r.name || r.email}</Tag>
									))}
								</div>
							)}
					</Card>

					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: 16,
						}}
					>
						<Title level={3} style={{ margin: 0 }}>
							{t("referrals")}
						</Title>
						<Button
							type="primary"
							icon={<PlusOutlined />}
							onClick={() => setModalOpen(true)}
						>
							{t("referCandidate")}
						</Button>
					</div>
					<Table
						columns={columns}
						dataSource={referrals}
						rowKey="referral_id"
						loading={loading}
						locale={{ emptyText: t("noReferralsOpening") }}
					/>

					<ReferCandidateModal
						openingId={opening.opening_id}
						open={modalOpen}
						onClose={() => setModalOpen(false)}
						onReferred={fetchAll}
					/>
				</>
			)}
		</>
	);
};

export default OpeningDetailPage;
