import React, { useCallback, useEffect, useState } from "react";
import { Button, Table, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	ReferralReceived,
	AgencyReferralState,
	ListReferralsReceivedResponse,
	DeclineReferralRequest,
} from "vetchium-specs/hub/referrals";
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

export const ReferralInboxPage: React.FC = () => {
	const { t, i18n } = useTranslation("referrals");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const [referrals, setReferrals] = useState<ReferralReceived[]>([]);
	const [loading, setLoading] = useState(false);

	const fetchReferrals = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/list-referrals-received`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ limit: 20 }),
			});
			if (res.status === 200) {
				const data: ListReferralsReceivedResponse = await res.json();
				setReferrals(data.referrals ?? []);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken]);

	useEffect(() => {
		fetchReferrals();
	}, [fetchReferrals]);

	const handleApply = (record: ReferralReceived) => {
		navigate(
			`/org/${record.consumer_org_domain}/openings/${record.opening_number}/apply?via=${encodeURIComponent(record.agency_org_domain)}`
		);
	};

	const handleDecline = async (referralId: string) => {
		if (!sessionToken) return;
		const apiBaseUrl = await getApiBaseUrl();
		const body: DeclineReferralRequest = { referral_id: referralId };
		await fetch(`${apiBaseUrl}/hub/decline-referral`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			},
			body: JSON.stringify(body),
		});
		fetchReferrals();
	};

	const columns = [
		{
			title: t("companyOpening"),
			key: "company_opening",
			render: (_: unknown, record: ReferralReceived) =>
				`${record.opening_title} — ${record.consumer_org_domain}`,
		},
		{
			title: t("referredBy"),
			key: "referred_by",
			render: (_: unknown, record: ReferralReceived) =>
				record.agency_org_name === record.agency_org_domain
					? record.agency_org_name
					: `${record.agency_org_name} (${record.agency_org_domain})`,
		},
		{
			title: t("statement"),
			dataIndex: "statement_text",
			key: "statement_text",
			render: (v?: string) => v ?? "—",
		},
		{
			title: t("received"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDate(v, i18n.language),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (state: AgencyReferralState) => (
				<Tag color={stateColors[state]}>{t(state)}</Tag>
			),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, record: ReferralReceived) =>
				record.state === "pending" ? (
					<>
						<Button
							type="primary"
							size="small"
							style={{ marginRight: 8 }}
							onClick={() => handleApply(record)}
						>
							{t("applyChooseAgency")}
						</Button>
						<Button
							danger
							size="small"
							onClick={() => handleDecline(record.referral_id)}
						>
							{t("decline")}
						</Button>
					</>
				) : null,
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
			<Title level={2} style={{ marginBottom: 24 }}>
				{t("inboxTitle")}
			</Title>
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
