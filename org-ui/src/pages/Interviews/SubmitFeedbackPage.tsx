import React, { useState } from "react";
import { Button, Form, Input, Select, Spin, Typography, message } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { SubmitInterviewFeedbackRequest } from "vetchium-specs/org/interviews";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;
const { TextArea } = Input;

export const SubmitFeedbackPage: React.FC = () => {
	const { t } = useTranslation("interviews");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { interviewId, candidacyId } = useParams<{
		interviewId: string;
		candidacyId: string;
	}>();
	const [form] = Form.useForm();
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (values: {
		decision: string;
		positives: string;
		negatives: string;
		overall_assessment: string;
		candidate_feedback?: string;
	}) => {
		if (!sessionToken || !interviewId) return;
		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: SubmitInterviewFeedbackRequest = {
				interview_id: interviewId,
				decision: values.decision as SubmitInterviewFeedbackRequest["decision"],
				positives: values.positives,
				negatives: values.negatives,
				overall_assessment: values.overall_assessment,
				...(values.candidate_feedback
					? { candidate_feedback: values.candidate_feedback }
					: {}),
			};
			const res = await fetch(`${apiBaseUrl}/org/submit-interview-feedback`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				message.success("Feedback submitted");
				navigate(`/candidacies/${candidacyId}`);
			} else if (res.status === 403) {
				message.error(
					"You must be listed as an interviewer to submit feedback"
				);
			} else if (res.status === 400) {
				const errs = await res.json();
				if (Array.isArray(errs)) {
					errs.forEach((e: { message: string }) => message.error(e.message));
				}
			} else {
				message.error("Failed to submit feedback");
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 700,
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
				{t("feedbackTitle")}
			</Title>

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					<Form.Item
						name="decision"
						label={t("decision")}
						rules={[{ required: true }]}
					>
						<Select
							options={[
								{ value: "strong_yes", label: t("strong_yes") },
								{ value: "yes", label: t("yes") },
								{ value: "neutral", label: t("neutral") },
								{ value: "no", label: t("no") },
								{ value: "strong_no", label: t("strong_no") },
							]}
						/>
					</Form.Item>

					<Form.Item
						name="positives"
						label={t("positives")}
						rules={[{ required: true }, { min: 1, max: 4000 }]}
					>
						<TextArea rows={4} maxLength={4000} showCount />
					</Form.Item>

					<Form.Item
						name="negatives"
						label={t("negatives")}
						rules={[{ required: true }, { min: 1, max: 4000 }]}
					>
						<TextArea rows={4} maxLength={4000} showCount />
					</Form.Item>

					<Form.Item
						name="overall_assessment"
						label={t("overallAssessment")}
						rules={[{ required: true }, { min: 1, max: 4000 }]}
					>
						<TextArea rows={4} maxLength={4000} showCount />
					</Form.Item>

					<Form.Item name="candidate_feedback" label={t("candidateFeedback")}>
						<TextArea rows={3} maxLength={2000} showCount />
					</Form.Item>

					<Form.Item>
						<Button type="primary" htmlType="submit" loading={submitting}>
							{t("submitFeedback")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};
