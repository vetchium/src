import React, { useState } from "react";
import {
	Button,
	DatePicker,
	Form,
	Input,
	Select,
	Spin,
	Typography,
	message,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ScheduleInterviewRequest } from "vetchium-specs/org/interviews";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import dayjs from "dayjs";

const { Title } = Typography;
const { TextArea } = Input;

export const ScheduleInterviewPage: React.FC = () => {
	const { t } = useTranslation("interviews");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { candidacyId } = useParams<{ candidacyId: string }>();
	const [form] = Form.useForm();
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (values: {
		interview_type: string;
		starts_at: ReturnType<typeof dayjs>;
		ends_at: ReturnType<typeof dayjs>;
		description?: string;
		interviewer_emails: string;
	}) => {
		if (!sessionToken || !candidacyId) return;
		const emailList = values.interviewer_emails
			.split(/[\n,]/)
			.map((e) => e.trim())
			.filter(Boolean);
		if (emailList.length < 1 || emailList.length > 5) {
			message.error("Must specify 1–5 interviewer email addresses");
			return;
		}

		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: ScheduleInterviewRequest = {
				candidacy_id: candidacyId,
				interview_type:
					values.interview_type as ScheduleInterviewRequest["interview_type"],
				starts_at: values.starts_at.toISOString(),
				ends_at: values.ends_at.toISOString(),
				...(values.description ? { description: values.description } : {}),
				interviewer_email_addresses: emailList,
			};
			const res = await fetch(`${apiBaseUrl}/org/schedule-interview`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 201) {
				message.success("Interview scheduled");
				navigate(`/candidacies/${candidacyId}`);
			} else if (res.status === 400) {
				const errs = await res.json();
				if (Array.isArray(errs)) {
					errs.forEach((e: { message: string }) => message.error(e.message));
				}
			} else if (res.status === 422) {
				message.error("Candidacy is not in interviewing state");
			} else {
				message.error("Failed to schedule interview");
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 600,
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
				{t("scheduleTitle")}
			</Title>

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					<Form.Item
						name="interview_type"
						label={t("interviewType")}
						rules={[{ required: true }]}
					>
						<Select
							options={[
								{ value: "in_person", label: t("in_person") },
								{ value: "video", label: t("video") },
								{ value: "take_home", label: t("take_home") },
								{ value: "other", label: t("other") },
							]}
						/>
					</Form.Item>

					<Form.Item
						name="starts_at"
						label={t("startsAt")}
						rules={[{ required: true }]}
					>
						<DatePicker showTime style={{ width: "100%" }} />
					</Form.Item>

					<Form.Item
						name="ends_at"
						label={t("endsAt")}
						rules={[{ required: true }]}
					>
						<DatePicker showTime style={{ width: "100%" }} />
					</Form.Item>

					<Form.Item name="description" label={t("description")}>
						<TextArea rows={3} maxLength={2000} />
					</Form.Item>

					<Form.Item
						name="interviewer_emails"
						label={t("interviewers")}
						rules={[{ required: true }]}
						extra="One email address per line or comma-separated (1–5)"
					>
						<TextArea rows={4} placeholder="interviewer@company.com" />
					</Form.Item>

					<Form.Item>
						<Button type="primary" htmlType="submit" loading={submitting}>
							{t("schedule")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};
