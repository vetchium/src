import React, { useState } from "react";
import { Button, Form, Input, Select, Spin, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type { NominateColleagueRequest } from "vetchium-specs/hub/referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;
const { TextArea } = Input;

export const NominatePage: React.FC = () => {
	const { t } = useTranslation("referrals");
	const { sessionToken } = useAuth();
	const { orgDomain, openingNumber } = useParams<{
		orgDomain: string;
		openingNumber: string;
	}>();
	const navigate = useNavigate();
	const [form] = Form.useForm();
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (values: {
		candidate_handle: string;
		statement_text: string;
	}) => {
		if (!sessionToken || !orgDomain || !openingNumber) return;
		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: NominateColleagueRequest = {
				candidate_handle: values.candidate_handle,
				org_domain: orgDomain,
				opening_number: parseInt(openingNumber, 10),
				statement_text: values.statement_text,
			};
			const res = await fetch(`${apiBaseUrl}/hub/nominate-colleague-for-role`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				message.success(t("nominationSuccess"));
				navigate("/");
			} else {
				message.error(t("serverError", { ns: "common" }));
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
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>
			<Title level={2} style={{ marginBottom: 24 }}>
				{t("nominate")} — {orgDomain} #{openingNumber}
			</Title>
			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					<Form.Item
						name="candidate_handle"
						label={t("chooseColleague")}
						rules={[{ required: true }]}
					>
						<Select showSearch={{ filterOption: true }} placeholder="@handle" />
					</Form.Item>
					<Form.Item
						name="statement_text"
						label={t("whyFit")}
						rules={[
							{ required: true },
							{ min: 100, message: "Minimum 100 characters" },
							{ max: 2000, message: "Maximum 2000 characters" },
						]}
					>
						<TextArea rows={6} minLength={100} maxLength={2000} />
					</Form.Item>
					<Form.Item>
						<Button type="primary" htmlType="submit">
							{t("sendNomination")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};
