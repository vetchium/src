import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
	Alert,
	Button,
	Select,
	Space,
	Table,
	Tag,
	Typography,
	App as AntApp,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeftOutlined, SettingOutlined } from "@ant-design/icons";
import type {
	AgencyRecruiterRef,
	AssignedOpening,
	AssignOpeningRecruitersRequest,
	ListAgencyRecruitersResponse,
	ListAssignedOpeningsResponse,
	ReferralStateCounts,
	RemoveOpeningRecruiterRequest,
} from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDate } from "../../utils/dateFormat";

const { Title } = Typography;

const countColor: Record<keyof ReferralStateCounts, string> = {
	pending: "orange",
	accepted_applied: "green",
	declined: "red",
	expired: "default",
	not_selected: "default",
};

const AgencyWorkspacePage: React.FC = () => {
	const { t, i18n } = useTranslation("agencyReferrals");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = AntApp.useApp();

	const isLead =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_agency_recruiters") ||
		false;

	const [openings, setOpenings] = useState<AssignedOpening[]>([]);
	const [recruiters, setRecruiters] = useState<AgencyRecruiterRef[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<"forbidden" | "generic" | null>(null);
	const [clientFilter, setClientFilter] = useState<string>("");
	const [recruiterFilter, setRecruiterFilter] = useState<string>("");

	const fetchOpenings = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		setError(null);
		try {
			const baseUrl = await getApiBaseUrl();
			const body: Record<string, unknown> = { limit: 100 };
			if (clientFilter) body.filter_client_domain = clientFilter;
			if (recruiterFilter) body.filter_recruiter = recruiterFilter;
			const res = await fetch(`${baseUrl}/org/list-assigned-openings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			if (res.status === 200) {
				const data: ListAssignedOpeningsResponse = await res.json();
				setOpenings(data.openings ?? []);
			} else if (res.status === 403) {
				setError("forbidden");
			} else {
				setError("generic");
			}
		} catch {
			setError("generic");
		} finally {
			setLoading(false);
		}
	}, [sessionToken, clientFilter, recruiterFilter]);

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
			// non-fatal: inline editing simply won't have options
		}
	}, [sessionToken, isLead]);

	useEffect(() => {
		fetchOpenings();
	}, [fetchOpenings]);

	useEffect(() => {
		fetchRecruiters();
	}, [fetchRecruiters]);

	// Client domains for the filter, derived from the current page of openings.
	const clientDomains = useMemo(() => {
		const set = new Set<string>();
		openings.forEach((o) => set.add(o.consumer_org_domain));
		return Array.from(set).sort();
	}, [openings]);

	const updateRecruiters = useCallback(
		async (opening: AssignedOpening, nextIds: string[]) => {
			if (!sessionToken) return;
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
				fetchOpenings();
			} catch {
				message.error(t("loadError"));
			}
		},
		[sessionToken, message, t, fetchOpenings]
	);

	const renderCounts = (counts: ReferralStateCounts) => {
		const keys: (keyof ReferralStateCounts)[] = [
			"pending",
			"accepted_applied",
			"declined",
			"expired",
			"not_selected",
		];
		const pills = keys
			.filter((k) => counts[k] > 0)
			.map((k) => (
				<Tag key={k} color={countColor[k]}>
					{counts[k]} {t(k)}
				</Tag>
			));
		return pills.length > 0 ? <Space size={[0, 4]}>{pills}</Space> : "—";
	};

	const recruiterOptions = recruiters.map((r) => ({
		value: r.org_user_id,
		label: r.name || r.email,
	}));

	const columns = [
		{
			title: t("client"),
			dataIndex: "consumer_org_domain",
			key: "client",
		},
		{
			title: t("opening"),
			key: "opening",
			render: (_: unknown, o: AssignedOpening) => (
				<Link to={`/referrals/openings/${o.opening_id}`}>
					{o.title} #{o.opening_number}
				</Link>
			),
		},
		{
			title: t("recruitersTitle"),
			key: "recruiters",
			render: (_: unknown, o: AssignedOpening) => {
				if (isLead) {
					return (
						<Space align="center">
							<Select
								mode="multiple"
								style={{ minWidth: 220 }}
								placeholder={t("assignRecruiters")}
								options={recruiterOptions}
								value={
									o.recruiters_are_default
										? []
										: o.recruiters.map((r) => r.org_user_id)
								}
								onChange={(ids: string[]) => updateRecruiters(o, ids)}
							/>
							{o.recruiters_are_default && o.recruiters.length > 0 && (
								<Tag color="blue">{t("defaultBadge")}</Tag>
							)}
						</Space>
					);
				}
				if (o.recruiters.length === 0) return "—";
				return (
					<Space size={[0, 4]} wrap>
						{o.recruiters.map((r) => (
							<Tag key={r.org_user_id}>{r.name || r.email}</Tag>
						))}
						{o.recruiters_are_default && (
							<Tag color="blue">{t("defaultBadge")}</Tag>
						)}
					</Space>
				);
			},
		},
		{
			title: t("referrals"),
			key: "counts",
			render: (_: unknown, o: AssignedOpening) =>
				renderCounts(o.referral_counts),
		},
		{
			title: t("assignedAt"),
			dataIndex: "assigned_at",
			key: "assigned_at",
			render: (v: string) => formatDate(v, i18n.language),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, o: AssignedOpening) => (
				<Link to={`/referrals/openings/${o.opening_id}`}>
					{t("openAction")}
				</Link>
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
			{error === "forbidden" ? (
				<>
					<Title level={2} style={{ marginBottom: 24 }}>
						{t("workspaceTitle")}
					</Title>
					<Alert type="error" showIcon title={t("accessDenied")} />
				</>
			) : (
				<>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: 24,
						}}
					>
						<Title level={2} style={{ margin: 0 }}>
							{t("workspaceTitle")}
						</Title>
						{isLead && (
							<Link to="/referrals/defaults">
								<Button icon={<SettingOutlined />}>
									{t("clientDefaults")}
								</Button>
							</Link>
						)}
					</div>

					{error === "generic" && (
						<Alert
							type="error"
							showIcon
							title={t("loadError")}
							style={{ marginBottom: 16 }}
						/>
					)}

					{!isLead && (
						<Alert
							type="info"
							showIcon
							title={t("myAssignmentsHint")}
							style={{ marginBottom: 16 }}
						/>
					)}

					<Space style={{ marginBottom: 16 }} wrap>
						<Select
							style={{ minWidth: 200 }}
							value={clientFilter}
							onChange={setClientFilter}
							options={[
								{ value: "", label: t("allClients") },
								...clientDomains.map((d) => ({ value: d, label: d })),
							]}
						/>
						{isLead && (
							<Select
								style={{ minWidth: 200 }}
								value={recruiterFilter}
								onChange={setRecruiterFilter}
								options={[
									{ value: "", label: t("allRecruiters") },
									{ value: "me", label: t("me") },
									{ value: "unassigned", label: t("unassigned") },
									...recruiterOptions,
								]}
							/>
						)}
					</Space>

					<Table
						columns={columns}
						dataSource={openings}
						rowKey="opening_id"
						loading={loading}
						locale={{ emptyText: t("noOpenings") }}
					/>
				</>
			)}
		</div>
	);
};

export default AgencyWorkspacePage;
