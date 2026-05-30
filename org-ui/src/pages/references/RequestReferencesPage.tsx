import React, { useState } from "react";
import {
	Button,
	Form,
	InputNumber,
	Spin,
	Typography,
	message,
	Card,
	Space,
	Divider,
	DatePicker,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type { RequestReferencesRequest } from "vetchium-specs/org/references";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import dayjs from "dayjs";

const { Title } = Typography;

export const RequestReferencesPage: React.FC = () => {
	const { t } = useTranslation("hiring");
	const { sessionToken } = useAuth();
	const { candidacyId } = useParams<{ candidacyId: string }>();
	const navigate = useNavigate();
	const [form] = Form.useForm();
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (values: {
		max_references: number;
		response_deadline: dayjs.Dayjs;
		questions?: Array<{
			text: string;
			min_chars?: number;
			max_chars?: number;
			required: boolean;
		}>;
	}) => {
		if (!sessionToken || !candidacyId) return;
		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: RequestReferencesRequest = {
				candidacy_id: candidacyId,
				max_references: values.max_references,
				response_deadline: values.response_deadline.format("YYYY-MM-DD"),
				questions: (values.questions || []).map((q) => ({
					...q,
					question_id: crypto.randomUUID(),
					min_chars: q.min_chars ?? 0,
					max_chars: q.max_chars ?? 4000,
				})),
			};
			const res = await fetch(`${apiBaseUrl}/org/request-references`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 201) {
				message.success(t("references.requestSuccess"));
				navigate(`/candidacies/${candidacyId}`);
			} else {
				message.error(t("errors.requestFailed"));
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
				<Link to={`/candidacies/${candidacyId}`}>
					<Button icon={<ArrowLeftOutlined />}>{t("backToCandidacy")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("references.requestTitle")}
			</Title>

			<Card style={{ marginBottom: 24 }}>
				<Space orientation="vertical">
					<p>{t("references.requestDescription")}</p>
					<p>{t("references.referenceInfo")}</p>
				</Space>
			</Card>

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					<Form.Item
						name="max_references"
						label={t("references.maxReferences")}
						rules={[
							{ required: true, message: t("errors.fieldRequired") },
							{
								type: "number",
								min: 1,
								max: 5,
								message: t("errors.maxReferencesRange"),
							},
						]}
						initialValue={3}
					>
						<InputNumber min={1} max={5} />
					</Form.Item>

					<Form.Item
						name="response_deadline"
						label={t("references.responseDeadline")}
						rules={[{ required: true, message: t("errors.fieldRequired") }]}
						initialValue={dayjs().add(7, "days")}
					>
						<DatePicker />
					</Form.Item>

					<Divider />

					<Form.Item
						label={t("references.questionsOptional")}
						name="questions"
						initialValue={[]}
					>
						<div>
							<p style={{ fontSize: 12, color: "#999" }}>
								{t("references.questionsHelper")}
							</p>
						</div>
					</Form.Item>

					<Form.Item>
						<Space>
							<Button type="primary" htmlType="submit">
								{t("references.sendRequest")}
							</Button>
							<Button onClick={() => navigate(`/candidacies/${candidacyId}`)}>
								{t("cancel")}
							</Button>
						</Space>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};
