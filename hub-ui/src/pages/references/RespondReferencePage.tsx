import React, { useEffect, useState } from "react";
import {
	Button,
	Form,
	Input,
	Spin,
	Typography,
	message,
	Card,
	Space,
	Divider,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	SubmitReferenceResponseRequest,
	ReferenceQuestion,
} from "vetchium-specs/hub/references";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;
const { TextArea } = Input;

interface ReferenceNominationDetail {
	nomination_id: string;
	candidate_handle: string;
	org_domain: string;
	opening_title: string;
	questions: ReferenceQuestion[];
	state: string;
}

export const RespondReferencePage: React.FC = () => {
	const { t } = useTranslation("references");
	const { sessionToken } = useAuth();
	const { nominationId } = useParams<{ nominationId: string }>();
	const navigate = useNavigate();
	const [form] = Form.useForm();
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [nomination, setNomination] =
		useState<ReferenceNominationDetail | null>(null);

	useEffect(() => {
		const fetchNomination = async () => {
			if (!sessionToken || !nominationId) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const res = await fetch(`${apiBaseUrl}/hub/get-reference-nomination`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ nomination_id: nominationId }),
				});
				if (res.status === 200) {
					const data = (await res.json()) as ReferenceNominationDetail;
					setNomination(data);
				} else {
					message.error(t("failedToLoad"));
					navigate("/references");
				}
			} catch {
				message.error(t("serverError", { ns: "common" }));
				navigate("/references");
			} finally {
				setLoading(false);
			}
		};
		fetchNomination();
	}, [sessionToken, nominationId, navigate, t]);

	const handleSubmit = async (values: Record<string, string>) => {
		if (!sessionToken || !nominationId || !nomination) return;
		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const answers = nomination.questions.map((q) => ({
				question_id: q.question_id,
				response_text: values[`question_${q.question_id}`] || "",
			}));
			const req: SubmitReferenceResponseRequest = {
				nomination_id: nominationId,
				answers,
			};
			const res = await fetch(`${apiBaseUrl}/hub/submit-reference-response`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				message.success(t("responseSubmitted"));
				navigate("/references");
			} else {
				message.error(t("serverError", { ns: "common" }));
			}
		} finally {
			setSubmitting(false);
		}
	};

	if (loading) {
		return <Spin />;
	}

	if (!nomination) {
		return null;
	}

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
				<Link to="/references">
					<Button icon={<ArrowLeftOutlined />}>{t("backToInbox")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("respondToReference")}
			</Title>

			<Card style={{ marginBottom: 24 }}>
				<Space orientation="vertical" style={{ width: "100%" }}>
					<div>
						<strong>{t("candidate")}</strong>: {nomination.candidate_handle}
					</div>
					<div>
						<strong>{t("company")}</strong>: {nomination.org_domain}
					</div>
					<div>
						<strong>{t("role")}</strong>: {nomination.opening_title}
					</div>
				</Space>
			</Card>

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					{nomination.questions.map((question, index) => (
						<div key={question.question_id}>
							{index > 0 && <Divider />}
							<Form.Item
								name={`question_${question.question_id}`}
								label={question.text}
								rules={[
									{ required: question.required, message: t("fieldRequired") },
									{
										min: question.min_chars || 0,
										message: `${t("minimum")} ${question.min_chars} ${t("characters")}`,
									},
									{
										max: question.max_chars || 4000,
										message: `${t("maximum")} ${question.max_chars} ${t("characters")}`,
									},
								]}
							>
								<TextArea
									rows={4}
									minLength={question.min_chars || 0}
									maxLength={question.max_chars || 4000}
									placeholder={t("enterYourResponse")}
								/>
							</Form.Item>
						</div>
					))}
					<Form.Item>
						<Button type="primary" htmlType="submit">
							{t("submitResponse")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};
