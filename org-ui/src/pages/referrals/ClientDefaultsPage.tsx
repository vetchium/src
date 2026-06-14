import React, { useCallback, useEffect, useState } from "react";
import {
	Alert,
	Button,
	Card,
	Form,
	Select,
	Space,
	Table,
	Tag,
	Typography,
	App as AntApp,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	AgencyRecruiterRef,
	ClientDefaultRecruiter,
	ListAgencyRecruitersResponse,
	ListAssignedOpeningsResponse,
	ListClientDefaultRecruitersResponse,
	RemoveClientDefaultRecruiterRequest,
	SetClientDefaultRecruitersRequest,
} from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

const ClientDefaultsPage: React.FC = () => {
	const { t } = useTranslation("agencyReferrals");
	const { sessionToken } = useAuth();
	const { message } = AntApp.useApp();

	const [defaults, setDefaults] = useState<ClientDefaultRecruiter[]>([]);
	const [recruiters, setRecruiters] = useState<AgencyRecruiterRef[]>([]);
	const [clientDomains, setClientDomains] = useState<string[]>([]);
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
			const dRes = await post("/org/list-client-default-recruiters", {});
			if (dRes.status === 403) {
				setError("forbidden");
				return;
			}
			if (dRes.status !== 200) {
				setError("generic");
				return;
			}
			const dData: ListClientDefaultRecruitersResponse = await dRes.json();
			setDefaults(dData.defaults ?? []);

			const rRes = await post("/org/list-agency-recruiters", {});
			if (rRes.status === 200) {
				const rData: ListAgencyRecruitersResponse = await rRes.json();
				setRecruiters(rData.recruiters ?? []);
			}

			const oRes = await post("/org/list-assigned-openings", { limit: 100 });
			if (oRes.status === 200) {
				const oData: ListAssignedOpeningsResponse = await oRes.json();
				const set = new Set<string>();
				(oData.openings ?? []).forEach((o) => set.add(o.consumer_org_domain));
				setClientDomains(Array.from(set).sort());
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
		agency_org_user_ids: string[];
	}) => {
		const req: SetClientDefaultRecruitersRequest = {
			consumer_org_domain: values.consumer_org_domain,
			agency_org_user_ids: values.agency_org_user_ids,
		};
		const res = await post("/org/set-client-default-recruiters", req);
		if (res.status === 200) {
			message.success(t("defaultSaved"));
			form.resetFields();
			fetchAll();
		} else if (res.status === 403) {
			message.error(t("accessDenied"));
		} else {
			message.error(t("loadError"));
		}
	};

	const onRemove = async (domain: string, userId: string) => {
		const req: RemoveClientDefaultRecruiterRequest = {
			consumer_org_domain: domain,
			agency_org_user_id: userId,
		};
		const res = await post("/org/remove-client-default-recruiter", req);
		if (res.status === 200) {
			message.success(t("defaultRemoved"));
			fetchAll();
		} else {
			message.error(t("loadError"));
		}
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
			title: t("defaultRecruiters"),
			key: "recruiters",
			render: (_: unknown, d: ClientDefaultRecruiter) => (
				<Space size={[0, 4]} wrap>
					{d.recruiters.map((r) => (
						<Tag
							key={r.org_user_id}
							closable
							onClose={(e) => {
								e.preventDefault();
								onRemove(d.consumer_org_domain, r.org_user_id);
							}}
						>
							{r.name || r.email}
						</Tag>
					))}
				</Space>
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
			<Title level={2} style={{ marginBottom: 24 }}>
				{t("defaultsTitle")}
			</Title>

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

					<Card title={t("addDefault")} style={{ marginBottom: 24 }}>
						<Form form={form} layout="inline" onFinish={onSave}>
							<Form.Item
								name="consumer_org_domain"
								label={t("selectClientDomain")}
								rules={[{ required: true }]}
							>
								<Select
									style={{ minWidth: 220 }}
									options={clientDomains.map((d) => ({ value: d, label: d }))}
								/>
							</Form.Item>
							<Form.Item
								name="agency_org_user_ids"
								label={t("selectRecruiters")}
								rules={[{ required: true }]}
							>
								<Select
									mode="multiple"
									style={{ minWidth: 260 }}
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
