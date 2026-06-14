import React, { useCallback, useEffect, useState } from "react";
import { Button, Table, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import type {
	AgencyReferral,
	AgencyReferralState,
	ListAgencyReferralsResponse,
} from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDate } from "../../utils/dateFormat";

const { Title } = Typography;

const stateColors: Record<AgencyReferralState, string> = {
	pending: "orange",
	accepted_applied: "green",
	declined: "red",
	expired: "default",
	not_selected: "default",
};

const AgencyReferralsPage: React.FC = () => {
	const { t, i18n } = useTranslation("agencyReferrals");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const [referrals, setReferrals] = useState<AgencyReferral[]>([]);
	const [loading, setLoading] = useState(false);

	const fetchReferrals = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const res = await fetch(`${baseUrl}/org/list-agency-referrals`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ limit: 20 }),
			});
			if (res.status === 200) {
				const data: ListAgencyReferralsResponse = await res.json();
				setReferrals(data.referrals ?? []);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken]);

	useEffect(() => {
		fetchReferrals();
	}, [fetchReferrals]);

	const columns = [
		{
			title: t("candidate"),
			dataIndex: "candidate_handle",
			key: "candidate_handle",
		},
		{
			title: t("opening"),
			key: "opening",
			render: (_: unknown, r: AgencyReferral) =>
				`${r.opening_title} — ${r.consumer_org_domain} #${r.opening_number}`,
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (s: AgencyReferralState) => (
				<Tag color={stateColors[s]}>{t(s)}</Tag>
			),
		},
		{
			title: t("referredAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDate(v, i18n.language),
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
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 24,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("referralsTitle")}
				</Title>
				<Button
					type="primary"
					icon={<PlusOutlined />}
					onClick={() => navigate("/referrals/new")}
				>
					{t("refer")}
				</Button>
			</div>
			<Table
				columns={columns}
				dataSource={referrals}
				rowKey="referral_id"
				loading={loading}
				locale={{ emptyText: t("noReferrals") }}
			/>
		</div>
	);
};

export default AgencyReferralsPage;
