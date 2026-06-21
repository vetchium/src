import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	Button,
	Card,
	Empty,
	Select,
	Space,
	Spin,
	Table,
	Tag,
	Typography,
	App as AntApp,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import type {
	AgencyRecruiterRef,
	ClearClientDefaultAssigneeRequest,
	ClientDefaultAssignee,
	ListAgencyRecruitersResponse,
	ListClientDefaultAssigneesResponse,
	ListStaffingClientsResponse,
	SetClientDefaultAssigneeRequest,
} from "vetchium-specs/org/agency-referrals";
import type {
	ListMyClientsRequest,
	ListMyClientsResponse,
	MarketplaceClient,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDate } from "../../utils/dateFormat";

const { Title, Text, Paragraph } = Typography;

const SUB_STATUS_COLORS: Record<MarketplaceSubscriptionStatus, string> = {
	active: "success",
	cancelled: "error",
	expired: "warning",
};

export function ClientDetailPage() {
	const { t, i18n } = useTranslation("marketplace");
	const { t: ta } = useTranslation("agencyReferrals");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = AntApp.useApp();
	const { clientDomain = "" } = useParams<{ clientDomain: string }>();

	// Setting/clearing a default is lead-only (mirrors SetClientDefaultAssignee).
	const isLead =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_agency_recruiters") ||
		false;

	const [subscriptions, setSubscriptions] = useState<MarketplaceClient[]>([]);
	const [clientName, setClientName] = useState<string>("");
	const [isStaffingClient, setIsStaffingClient] = useState(false);
	const [canConfigureStaffing, setCanConfigureStaffing] = useState(false);
	const [recruiters, setRecruiters] = useState<AgencyRecruiterRef[]>([]);
	const [currentDefault, setCurrentDefault] =
		useState<AgencyRecruiterRef | null>(null);
	const [selectedAssignee, setSelectedAssignee] = useState<
		string | undefined
	>();
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	const post = useCallback(
		async (path: string, body: unknown) => {
			const baseUrl = await getApiBaseUrl();
			return fetch(`${baseUrl}${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
		},
		[sessionToken]
	);

	const fetchAll = useCallback(async () => {
		if (!sessionToken || !clientDomain) return;
		setLoading(true);
		try {
			// Marketplace subscriptions for this client (context). Best-effort: if the
			// caller lacks org:view_listings the table simply stays empty.
			const subReq: ListMyClientsRequest = {
				filter_consumer: clientDomain,
				limit: 100,
			};
			const subRes = await post("/org/marketplace/list-clients", subReq);
			if (subRes.status === 200) {
				const data: ListMyClientsResponse = await subRes.json();
				setSubscriptions(
					(data.clients ?? []).filter(
						(c) => c.consumer_org_domain === clientDomain
					)
				);
			}

			// Staffing-client identity: name + whether the staffing section applies.
			const scRes = await post("/org/list-staffing-clients", {});
			if (scRes.status === 200) {
				const data: ListStaffingClientsResponse = await scRes.json();
				const match = (data.clients ?? []).find(
					(c) => c.consumer_org_domain === clientDomain
				);
				if (match) {
					setIsStaffingClient(true);
					setClientName(match.consumer_org_name || clientDomain);
				}
			}

			// Current default assignee for this client. A 403 here means the caller
			// can't see agency-referral config → hide the staffing section entirely.
			const dRes = await post("/org/list-client-default-assignees", {});
			if (dRes.status === 200) {
				setCanConfigureStaffing(true);
				const data: ListClientDefaultAssigneesResponse = await dRes.json();
				const match = (data.defaults ?? []).find(
					(d: ClientDefaultAssignee) => d.consumer_org_domain === clientDomain
				);
				setCurrentDefault(match ? match.assignee : null);
				setSelectedAssignee(match ? match.assignee.org_user_id : undefined);
			}

			const rRes = await post("/org/list-agency-recruiters", {});
			if (rRes.status === 200) {
				const data: ListAgencyRecruitersResponse = await rRes.json();
				setRecruiters(data.recruiters ?? []);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, clientDomain, post]);

	useEffect(() => {
		fetchAll();
	}, [fetchAll]);

	const onSave = async () => {
		if (!selectedAssignee) return;
		setSaving(true);
		try {
			const req: SetClientDefaultAssigneeRequest = {
				consumer_org_domain: clientDomain,
				agency_org_user_id: selectedAssignee,
			};
			const res = await post("/org/set-client-default-assignee", req);
			if (res.status === 200) {
				message.success(ta("defaultSaved"));
				fetchAll();
			} else if (res.status === 422) {
				message.error(ta("inactiveAssigneeError"));
			} else if (res.status === 403) {
				message.error(ta("accessDenied"));
			} else {
				message.error(ta("loadError"));
			}
		} finally {
			setSaving(false);
		}
	};

	const onClear = async () => {
		setSaving(true);
		try {
			const req: ClearClientDefaultAssigneeRequest = {
				consumer_org_domain: clientDomain,
			};
			const res = await post("/org/clear-client-default-assignee", req);
			if (res.status === 200) {
				message.success(ta("defaultCleared"));
				setCurrentDefault(null);
				setSelectedAssignee(undefined);
			} else {
				message.error(ta("loadError"));
			}
		} finally {
			setSaving(false);
		}
	};

	const recruiterOptions = useMemo(
		() =>
			recruiters.map((r) => ({
				value: r.org_user_id,
				label: r.name || r.email,
			})),
		[recruiters]
	);

	const subColumns = [
		{
			title: t("clients.listingNumber"),
			dataIndex: "listing_number",
			key: "listing_number",
			render: (num: number) => <span>#{num}</span>,
		},
		{
			title: t("clients.status"),
			dataIndex: "status",
			key: "status",
			render: (status: MarketplaceSubscriptionStatus) => (
				<Tag color={SUB_STATUS_COLORS[status]}>{t(`subStatus.${status}`)}</Tag>
			),
		},
		{
			title: t("clients.subscribedAt"),
			dataIndex: "started_at",
			key: "started_at",
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
				<Link to="/marketplace/clients">
					<Button icon={<ArrowLeftOutlined />}>{t("clientDetail.back")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 4 }}>
				{clientName || clientDomain}
			</Title>
			{clientName && clientName !== clientDomain && (
				<Paragraph type="secondary" style={{ marginBottom: 24 }}>
					{clientDomain}
				</Paragraph>
			)}

			<Spin spinning={loading}>
				<Card
					title={t("clientDetail.subscriptions")}
					style={{ marginBottom: 24 }}
				>
					<Table
						columns={subColumns}
						dataSource={subscriptions}
						rowKey="subscription_id"
						pagination={false}
						locale={{ emptyText: t("clientDetail.noSubscriptions") }}
					/>
				</Card>

				{isStaffingClient && canConfigureStaffing && (
					<Card title={t("clientDetail.staffingSection")}>
						<Paragraph type="secondary" style={{ maxWidth: 720 }}>
							{t("clientDetail.staffingIntro")}
						</Paragraph>

						{!isLead ? (
							<Text>
								{ta("defaultAssignee")}:{" "}
								{currentDefault
									? currentDefault.name || currentDefault.email
									: t("clientDetail.noDefault")}
							</Text>
						) : (
							<Space wrap align="center">
								<Select
									style={{ minWidth: 300 }}
									placeholder={ta("selectAssignee")}
									showSearch={{ optionFilterProp: "label" }}
									options={recruiterOptions}
									value={selectedAssignee}
									onChange={setSelectedAssignee}
								/>
								<Button
									type="primary"
									loading={saving}
									disabled={
										!selectedAssignee ||
										selectedAssignee === currentDefault?.org_user_id
									}
									onClick={onSave}
								>
									{ta("save")}
								</Button>
								{currentDefault && (
									<Button danger loading={saving} onClick={onClear}>
										{ta("clearDefault")}
									</Button>
								)}
							</Space>
						)}
					</Card>
				)}

				{!loading && !isStaffingClient && (
					<Empty description={t("clientDetail.notStaffingClient")} />
				)}
			</Spin>
		</div>
	);
}
