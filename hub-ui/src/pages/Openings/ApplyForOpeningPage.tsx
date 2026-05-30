import React, { useState } from "react";
import { Button, Form, Input, Spin, Typography, Upload, message } from "antd";
import { ArrowLeftOutlined, UploadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { UploadFile } from "antd";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;
const { TextArea } = Input;

export const ApplyForOpeningPage: React.FC = () => {
	const { t } = useTranslation("openings");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { orgDomain, openingNumber } = useParams<{
		orgDomain: string;
		openingNumber: string;
	}>();
	const [coverLetter, setCoverLetter] = useState("");
	const [fileList, setFileList] = useState<UploadFile[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [form] = Form.useForm();

	const handleSubmit = async () => {
		if (!sessionToken || !orgDomain || !openingNumber) return;
		if (coverLetter.length < 100 || coverLetter.length > 5000) {
			message.error("Cover letter must be between 100 and 5000 characters");
			return;
		}
		if (fileList.length === 0 || !fileList[0].originFileObj) {
			message.error("Resume file is required");
			return;
		}

		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const formData = new FormData();
			formData.append("org_domain", orgDomain);
			formData.append("opening_number", openingNumber);
			formData.append("cover_letter", coverLetter);
			formData.append("resume", fileList[0].originFileObj);

			const res = await fetch(`${apiBaseUrl}/hub/apply-for-opening`, {
				method: "POST",
				headers: { Authorization: `Bearer ${sessionToken}` },
				body: formData,
			});

			if (res.status === 201) {
				message.success(t("applySuccess"));
				navigate("/my-applications");
			} else if (res.status === 409) {
				const body = await res.json();
				const errKey = body?.error ?? "liveApplicationExists";
				message.error(t(errKey));
			} else if (res.status === 404) {
				message.error("Opening not found");
			} else {
				message.error("Failed to submit application");
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 800,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to={`/org/${orgDomain}/openings/${openingNumber}`}>
					<Button icon={<ArrowLeftOutlined />}>{t("backToOpening")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("applyNow")} — {orgDomain}
			</Title>

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					<Form.Item
						label={t("coverLetter")}
						required
						help={`${coverLetter.length} / 5000`}
						validateStatus={
							coverLetter.length > 0 && coverLetter.length < 100
								? "error"
								: undefined
						}
					>
						<TextArea
							rows={10}
							maxLength={5000}
							value={coverLetter}
							onChange={(e) => setCoverLetter(e.target.value)}
							placeholder={t("coverLetterPlaceholder")}
						/>
					</Form.Item>

					<Form.Item label={t("resume")} required>
						<Upload
							beforeUpload={() => false}
							fileList={fileList}
							onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
							accept=".pdf,.docx"
							maxCount={1}
						>
							<Button icon={<UploadOutlined />}>{t("resume")}</Button>
						</Upload>
					</Form.Item>

					<Form.Item>
						<Button
							type="primary"
							htmlType="submit"
							loading={submitting}
							disabled={coverLetter.length < 100 || fileList.length === 0}
						>
							{t("submitApplication")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};
