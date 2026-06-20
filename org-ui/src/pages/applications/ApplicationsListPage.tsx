import React, { useCallback, useEffect, useState } from "react";
import { Button, Empty, Select, Spin, Table, Tag, Typography } from "antd";
import { ApartmentOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	OrgApplicationSummary,
	ListApplicationsRequest,
	ListApplicationsResponse,
} from "vetchium-specs/org/applications";
import type { ApplicationColorLabel } from "vetchium-specs/hub/applications";
import type {
	OpeningAgency,
	ListOpeningAgenciesResponse,
} from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;

const STATE_COLORS: Record<string, string> = {
	applied: "blue",
	shortlisted: "green",
	rejected: "red",
	withdrawn: "default",
	expired: "default",
};

const LABEL_COLORS: Record<string, string> = {
	green: "success",
	yellow: "warning",
	red: "error",
};

export const ApplicationsListPage: React.FC = () => {
	const { t, i18n } = useTranslation("applications");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { openingId } = useParams<{ openingId: string }>();
	const [applications, setApplications] = useState<OrgApplicationSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [stateFilter, setStateFilter] = useState<string[]>([]);
	const [labelFilter, setLabelFilter] = useState<ApplicationColorLabel[]>([]);
	const [agencyFilter, setAgencyFilter] = useState<string | undefined>();
	const [agencies, setAgencies] = useState<OpeningAgency[]>([]);

	const fetchApplications = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken || !openingId) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListApplicationsRequest = {
					opening_id: openingId,
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
					...(stateFilter.length > 0
						? {
								filter_state:
									stateFilter as ListApplicationsRequest["filter_state"],
							}
						: {}),
					...(labelFilter.length > 0 ? { filter_label: labelFilter } : {}),
					...(agencyFilter ? { filter_agency: agencyFilter } : {}),
				};
				const res = await fetch(`${apiBaseUrl}/org/list-applications`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data: ListApplicationsResponse = await res.json();
					setApplications((prev) =>
						paginationKey ? [...prev, ...data.applications] : data.applications
					);
					setNextKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, openingId, stateFilter, labelFilter, agencyFilter]
	);

	useEffect(() => {
		fetchApplications();
	}, [fetchApplications]);

	useEffect(() => {
		const fetchAgencies = async () => {
			if (!sessionToken || !openingId) return;
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/org/list-opening-agencies`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ opening_id: openingId }),
			});
			if (res.status === 200) {
				const data: ListOpeningAgenciesResponse = await res.json();
				setAgencies(data.agencies ?? []);
			}
		};
		fetchAgencies();
	}, [sessionToken, openingId]);

	const columns = [
		{
			title: t("candidate"),
			dataIndex: "candidate_handle",
			key: "candidate_handle",
			render: (handle: string, record: OrgApplicationSummary) => (
				<Link
					to={`/openings/${openingId}/applications/${record.application_id}`}
				>
					{record.candidate_display_name || handle}
				</Link>
			),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (state: string) => (
				<Tag color={STATE_COLORS[state] ?? "default"}>
					{t(state as "applied")}
				</Tag>
			),
		},
		{
			title: t("label"),
			dataIndex: "label",
			key: "label",
			render: (label: string | undefined) =>
				label ? (
					<Tag color={LABEL_COLORS[label] ?? "default"}>
						{t(
							`label${label.charAt(0).toUpperCase() + label.slice(1)}` as "labelGreen"
						)}
					</Tag>
				) : (
					<span style={{ color: "#999" }}>{t("labelNone")}</span>
				),
		},
		{
			title: t("source"),
			key: "source",
			render: (_: unknown, record: OrgApplicationSummary) =>
				record.referring_agency_domain ? (
					<Tag color="geekblue" icon={<ApartmentOutlined />}>
						{record.referring_agency_domain}
					</Tag>
				) : (
					<span style={{ color: "#999" }}>{t("sourceDirect")}</span>
				),
		},
		{
			title: t("appliedDate"),
			dataIndex: "applied_at",
			key: "applied_at",
			render: (v: string) => formatDateTime(v, i18n.language),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, record: OrgApplicationSummary) => (
				<Link
					to={`/openings/${openingId}/applications/${record.application_id}`}
				>
					{t("view")}
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
				<Link to="/openings">
					<Button icon={<ArrowLeftOutlined />}>{t("backToOpenings")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("title")}
			</Title>

			<div
				style={{
					marginBottom: 16,
					display: "flex",
					gap: 12,
					flexWrap: "wrap",
				}}
			>
				<Select
					mode="multiple"
					placeholder={t("filterByState")}
					style={{ minWidth: 280 }}
					value={stateFilter}
					onChange={(v) => setStateFilter(v)}
					options={[
						{ value: "applied", label: t("applied") },
						{ value: "shortlisted", label: t("shortlisted") },
						{ value: "rejected", label: t("rejected") },
						{ value: "withdrawn", label: t("withdrawn") },
						{ value: "expired", label: t("expired") },
					]}
					allowClear
				/>
				<Select<ApplicationColorLabel[]>
					mode="multiple"
					placeholder={t("filterByLabel")}
					style={{ minWidth: 240 }}
					value={labelFilter}
					onChange={(v) => setLabelFilter(v)}
					options={[
						{ value: "green", label: t("labelGreen") },
						{ value: "yellow", label: t("labelYellow") },
						{ value: "red", label: t("labelRed") },
					]}
					allowClear
				/>
				{agencies.length > 0 && (
					<Select
						placeholder={t("filterByAgency")}
						style={{ minWidth: 240 }}
						value={agencyFilter}
						onChange={(v) => setAgencyFilter(v)}
						options={agencies.map((a) => ({
							value: a.agency_org_domain,
							label: `${a.agency_org_name} (${a.agency_org_domain})`,
						}))}
						allowClear
					/>
				)}
			</div>

			<Spin spinning={loading}>
				{applications.length === 0 && !loading ? (
					<Empty />
				) : (
					<Table
						dataSource={applications}
						columns={columns}
						rowKey="application_id"
						pagination={false}
						onRow={(record) => ({
							onClick: () =>
								navigate(
									`/openings/${openingId}/applications/${record.application_id}`
								),
							style: { cursor: "pointer" },
						})}
					/>
				)}
				{nextKey && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button
							onClick={() => fetchApplications(nextKey)}
							loading={loading}
						>
							Load more
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
};
