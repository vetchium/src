import React, { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Spin, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	EndorsementRequestIncoming,
	WriteEndorsementRequest,
} from "vetchium-specs/hub/endorsements";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

export const WriteEndorsementPage: React.FC = () => {
	const { t } = useTranslation("endorsements");
	const { sessionToken } = useAuth();
	const { requestId } = useParams<{ requestId: string }>();
	const navigate = useNavigate();
	const [form] = Form.useForm();
	const [request, setRequest] = useState<EndorsementRequestIncoming | null>(
		null
	);
	const [loading, setLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const fetchRequest = useCallback(async () => {
		if (!sessionToken || !requestId) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(
				`${apiBaseUrl}/hub/list-endorsement-requests-incoming`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ limit: 100 }),
				}
			);
			if (res.status === 200) {
				const data: { requests: EndorsementRequestIncoming[] } =
					await res.json();
				const found = (data.requests ?? []).find(
					(r) => r.request_id === requestId
				);
				setRequest(found ?? null);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, requestId]);

	useEffect(() => {
		fetchRequest();
	}, [fetchRequest]);

	const handleSubmit = async (values: { text: string }) => {
		if (!sessionToken) return;
		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: WriteEndorsementRequest = {
				request_id: requestId,
				text: values.text,
			};
			const res = await fetch(`${apiBaseUrl}/hub/write-endorsement`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				message.success(t("submitSuccess"));
				navigate("/endorsement-requests");
			} else {
				message.error(t("serverError", { ns: "common" }));
			}
		} finally {
			setSubmitting(false);
		}
	};

	const handleDecline = async () => {
		if (!sessionToken || !requestId) return;
		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			await fetch(`${apiBaseUrl}/hub/decline-endorsement-request`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ request_id: requestId }),
			});
			navigate("/endorsement-requests");
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
				<Link to="/endorsement-requests">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>
			<Spin spinning={loading}>
				{request && (
					<>
						<Title level={2} style={{ marginBottom: 8 }}>
							Endorse {request.candidate_display_name} for{" "}
							{request.opening_title} at {request.org_domain}
						</Title>
						<Paragraph>
							{t("workedTogether", {
								domain: request.shared_domain,
								start: request.overlap_start_year,
								end: request.overlap_end_year,
								years: request.overlap_end_year - request.overlap_start_year,
							})}
						</Paragraph>
						{request.note && (
							<Paragraph>
								{t("candidateNote", {
									name: request.candidate_display_name,
									note: request.note,
								})}
							</Paragraph>
						)}
					</>
				)}
				<Spin spinning={submitting}>
					<Form form={form} layout="vertical" onFinish={handleSubmit}>
						<Form.Item
							name="text"
							label={t("endorsementText")}
							rules={[
								{ required: true },
								{ min: 100, message: "Minimum 100 characters" },
								{ max: 2000, message: "Maximum 2000 characters" },
							]}
						>
							<TextArea
								rows={8}
								minLength={100}
								maxLength={2000}
								placeholder={t("endorsementPlaceholder")}
							/>
						</Form.Item>
						<Form.Item>
							<Button
								type="primary"
								htmlType="submit"
								style={{ marginRight: 8 }}
							>
								{t("submitEndorsement")}
							</Button>
							<Button danger onClick={handleDecline}>
								{t("declineButton")}
							</Button>
						</Form.Item>
					</Form>
				</Spin>
			</Spin>
		</div>
	);
};
