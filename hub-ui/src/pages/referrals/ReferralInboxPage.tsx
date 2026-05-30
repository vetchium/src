import React, { useCallback, useEffect, useState } from "react";
import { Button, Table, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	ReferralReceived,
	ReferralState,
	ListReferralsReceivedResponse,
	AcceptReferralResponse,
} from "vetchium-specs/hub/referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

const stateColors: Record<ReferralState, string> = {
	pending: "orange",
	accepted_applied: "green",
	declined: "red",
	expired: "default",
};

export const ReferralInboxPage: React.FC = () => {
	const { t } = useTranslation("referrals");
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

	const handleAccept = async (nominationId: string) => {
		if (!sessionToken) return;
		const apiBaseUrl = await getApiBaseUrl();
		const res = await fetch(`${apiBaseUrl}/hub/accept-referral`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			},
			body: JSON.stringify({ nomination_id: nominationId }),
		});
		if (res.status === 200) {
			const data: AcceptReferralResponse = await res.json();
			navigate(`/org/${data.org_domain}/openings/${data.opening_number}/apply`);
		}
	};

	const handleDecline = async (nominationId: string) => {
		if (!sessionToken) return;
		const apiBaseUrl = await getApiBaseUrl();
		await fetch(`${apiBaseUrl}/hub/decline-referral`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			},
			body: JSON.stringify({ nomination_id: nominationId }),
		});
		fetchReferrals();
	};

	const columns = [
		{
			title: t("referrer"),
			dataIndex: "referrer_handle",
			key: "referrer_handle",
			render: (handle: string, record: ReferralReceived) =>
				`${record.referrer_display_name} (@${handle})`,
		},
		{
			title: t("role"),
			dataIndex: "opening_title",
			key: "opening_title",
		},
		{
			title: t("company"),
			dataIndex: "org_domain",
			key: "org_domain",
		},
		{
			title: t("workedTogether"),
			key: "worked_together",
			render: (_: unknown, record: ReferralReceived) =>
				`${record.shared_domain} ${record.overlap_start_year}–${record.overlap_end_year}`,
		},
		{
			title: t("received"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => new Date(v).toLocaleDateString(),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (state: ReferralState) => (
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
							onClick={() => handleAccept(record.nomination_id)}
						>
							{t("acceptAndApply")}
						</Button>
						<Button
							danger
							size="small"
							onClick={() => handleDecline(record.nomination_id)}
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
				{t("title")}
			</Title>
			<Table
				columns={columns}
				dataSource={referrals}
				rowKey="nomination_id"
				loading={loading}
				locale={{ emptyText: t("noReferrals") }}
			/>
		</div>
	);
};
