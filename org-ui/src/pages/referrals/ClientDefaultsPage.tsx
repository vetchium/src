import React, { useCallback, useEffect, useState } from "react";
import {
	Alert,
	Button,
	Card,
	Empty,
	Form,
	Select,
	Table,
	Typography,
	App as AntApp,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	AgencyRecruiterRef,
	ClearClientDefaultAssigneeRequest,
	ClientDefaultAssignee,
	ListAgencyRecruitersResponse,
	ListClientDefaultAssigneesResponse,
	ListStaffingClientsResponse,
	SetClientDefaultAssigneeRequest,
	StaffingClient,
} from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Paragraph } = Typography;

const ClientDefaultsPage: React.FC = () => {
	const { t } = useTranslation("agencyReferrals");
	const { sessionToken } = useAuth();
	const { message } = AntApp.useApp();

	const [defaults, setDefaults] = useState<ClientDefaultAssignee[]>([]);
	const [recruiters, setRecruiters] = useState<AgencyRecruiterRef[]>([]);
	const [clients, setClients] = useState<StaffingClient[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<"forbidden" | "generic" | null>(null);
	const [form] = Form.useForm();

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
		if (!sessionToken) return;
		setLoading(true);
		setError(null);
		try {
			const dRes = await post("/org/list-client-default-assignees", {});
			if (dRes.status === 403) {
				setError("forbidden");
				return;
			}
			if (dRes.status !== 200) {
				setError("generic");
				return;
			}
			const dData: ListClientDefaultAssigneesResponse = await dRes.json();
			setDefaults(dData.defaults ?? []);

			const rRes = await post("/org/list-agency-recruiters", {});
			if (rRes.status === 200) {
				const rData: ListAgencyRecruitersResponse = await rRes.json();
				setRecruiters(rData.recruiters ?? []);
			}

			// Clients are every org with an active staffing subscription with this
			// agency — available as soon as they subscribe, no opening required.
			const cRes = await post("/org/list-staffing-clients", {});
			if (cRes.status === 200) {
				const cData: ListStaffingClientsResponse = await cRes.json();
				setClients(cData.clients ?? []);
			}
		} catch {
			setError("generic");
		} finally {
			setLoading(false);
		}
	}, [sessionToken, post]);

	useEffect(() => {
		fetchAll();
	}, [fetchAll]);

	const onSave = async (values: {
		consumer_org_domain: string;
		agency_org_user_id: string;
	}) => {
		const req: SetClientDefaultAssigneeRequest = {
			consumer_org_domain: values.consumer_org_domain,
			agency_org_user_id: values.agency_org_user_id,
		};
		const res = await post("/org/set-client-default-assignee", req);
		if (res.status === 200) {
			message.success(t("defaultSaved"));
			form.resetFields();
			fetchAll();
		} else if (res.status === 422) {
			message.error(t("inactiveAssigneeError"));
		} else if (res.status === 403) {
			message.error(t("accessDenied"));
		} else {
			message.error(t("loadError"));
		}
	};

	const onClear = async (domain: string) => {
		const req: ClearClientDefaultAssigneeRequest = {
			consumer_org_domain: domain,
		};
		const res = await post("/org/clear-client-default-assignee", req);
		if (res.status === 200) {
			message.success(t("defaultCleared"));
			fetchAll();
		} else {
			message.error(t("loadError"));
		}
	};

	const recruiterOptions = recruiters.map((r) => ({
		value: r.org_user_id,
		label: r.name || r.email,
	}));

	// Show every staffing client, with its display name when it differs from the
	// domain, so the picker is meaningful before any opening is assigned.
	const clientLabel = (c: StaffingClient) =>
		c.consumer_org_name && c.consumer_org_name !== c.consumer_org_domain
			? `${c.consumer_org_name} (${c.consumer_org_domain})`
			: c.consumer_org_domain;

	const clientOptions = clients.map((c) => ({
		value: c.consumer_org_domain,
		label: clientLabel(c),
	}));

	const nameByDomain = new Map(
		clients.map((c) => [c.consumer_org_domain, clientLabel(c)])
	);

	const columns = [
		{
			title: t("clientLabel"),
			key: "client",
			render: (_: unknown, d: ClientDefaultAssignee) =>
				nameByDomain.get(d.consumer_org_domain) ?? d.consumer_org_domain,
		},
		{
			title: t("defaultAssignee"),
			key: "assignee",
			render: (_: unknown, d: ClientDefaultAssignee) =>
				d.assignee.name || d.assignee.email,
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, d: ClientDefaultAssignee) => (
				<Button
					danger
					size="small"
					onClick={() => onClear(d.consumer_org_domain)}
				>
					{t("clearDefault")}
				</Button>
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
				<Link to="/referrals">
					<Button icon={<ArrowLeftOutlined />}>{t("backToWorkspace")}</Button>
				</Link>
			</div>
			<Title level={2} style={{ marginBottom: 8 }}>
				{t("defaultsTitle")}
			</Title>
			<Paragraph type="secondary" style={{ maxWidth: 720, marginBottom: 24 }}>
				{t("defaultsIntro")}
			</Paragraph>

			{error === "forbidden" ? (
				<Alert type="error" showIcon title={t("accessDenied")} />
			) : (
				<>
					{error === "generic" && (
						<Alert
							type="error"
							showIcon
							title={t("loadError")}
							style={{ marginBottom: 16 }}
						/>
					)}

					{clients.length === 0 && !loading ? (
						<Empty description={t("noStaffingClients")} />
					) : (
						<Card title={t("setDefault")} style={{ marginBottom: 24 }}>
							<Form form={form} layout="inline" onFinish={onSave}>
								<Form.Item
									name="consumer_org_domain"
									label={t("clientLabel")}
									rules={[{ required: true }]}
								>
									<Select
										style={{ minWidth: 260 }}
										placeholder={t("clientPlaceholder")}
										showSearch={{ optionFilterProp: "label" }}
										options={clientOptions}
										notFoundContent={t("noStaffingClients")}
									/>
								</Form.Item>
								<Form.Item
									name="agency_org_user_id"
									label={t("defaultAssignee")}
									rules={[{ required: true }]}
								>
									<Select
										style={{ minWidth: 300 }}
										placeholder={t("selectAssignee")}
										showSearch={{ optionFilterProp: "label" }}
										options={recruiterOptions}
									/>
								</Form.Item>
								<Form.Item>
									<Button type="primary" htmlType="submit">
										{t("save")}
									</Button>
								</Form.Item>
							</Form>
						</Card>
					)}

					<Table
						columns={columns}
						dataSource={defaults}
						rowKey="consumer_org_domain"
						loading={loading}
						locale={{ emptyText: t("noDefaults") }}
					/>
				</>
			)}
		</div>
	);
};

export default ClientDefaultsPage;
