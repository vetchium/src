import React, { useCallback, useEffect, useState } from "react";
import {
	Button,
	Form,
	Input,
	Select,
	Spin,
	Typography,
	App as AntApp,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	AssignedOpening,
	ListAssignedOpeningsResponse,
	ReferCandidateRequest,
} from "vetchium-specs/org/agency-referrals";
import { validateReferCandidateRequest } from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

const ReferCandidatePage: React.FC = () => {
	const { t } = useTranslation("agencyReferrals");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { message } = AntApp.useApp();
	const [openings, setOpenings] = useState<AssignedOpening[]>([]);
	const [loading, setLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [form] = Form.useForm();

	const fetchOpenings = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const res = await fetch(`${baseUrl}/org/list-assigned-openings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ limit: 100 }),
			});
			if (res.status === 200) {
				const data: ListAssignedOpeningsResponse = await res.json();
				setOpenings(data.openings ?? []);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken]);

	useEffect(() => {
		fetchOpenings();
	}, [fetchOpenings]);

	const onFinish = async (values: {
		opening_id: string;
		candidate_handle: string;
		statement_text?: string;
	}) => {
		if (!sessionToken) return;
		const req: ReferCandidateRequest = {
			opening_id: values.opening_id,
			candidate_handle: values.candidate_handle,
			statement_text: values.statement_text || undefined,
		};
		const errs = validateReferCandidateRequest(req);
		if (errs.length > 0) {
			message.error(errs[0]?.message ?? t("errGeneric"));
			return;
		}
		setSubmitting(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const res = await fetch(`${baseUrl}/org/refer-candidate`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 201) {
				message.success(t("referSuccess"));
				navigate("/referrals");
			} else if (res.status === 403) {
				message.error(t("errNotAssigned"));
			} else if (res.status === 404) {
				message.error(t("errCandidateNotFound"));
			} else if (res.status === 409) {
				message.error(t("errDuplicate"));
			} else if (res.status === 422) {
				message.error(t("errOpeningNotPublished"));
			} else {
				message.error(t("errGeneric"));
			}
		} finally {
			setSubmitting(false);
		}
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
				<Link to="/referrals">
					<Button icon={<ArrowLeftOutlined />}>{t("backToReferrals")}</Button>
				</Link>
			</div>
			<Title level={2} style={{ marginBottom: 24 }}>
				{t("referTitle")}
			</Title>
			<Spin spinning={loading || submitting}>
				<Form
					form={form}
					layout="vertical"
					onFinish={onFinish}
					style={{ maxWidth: 600 }}
				>
					<Form.Item
						name="opening_id"
						label={t("opening")}
						rules={[{ required: true }]}
					>
						<Select
							placeholder={t("selectOpening")}
							options={openings.map((o) => ({
								value: o.opening_id,
								label: `${o.title} — ${o.consumer_org_domain} #${o.opening_number}`,
							}))}
						/>
					</Form.Item>
					<Form.Item
						name="candidate_handle"
						label={t("candidateHandle")}
						rules={[{ required: true }]}
					>
						<Input placeholder="@handle" />
					</Form.Item>
					<Form.Item name="statement_text" label={t("statement")}>
						<Input.TextArea maxLength={2000} rows={4} />
					</Form.Item>
					<Form.Item>
						<Button type="primary" htmlType="submit" loading={submitting}>
							{t("refer")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};

export default ReferCandidatePage;
