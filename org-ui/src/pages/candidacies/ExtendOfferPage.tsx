import React, { useState } from "react";
import {
	Button,
	DatePicker,
	Form,
	Input,
	InputNumber,
	Spin,
	Typography,
	Upload,
	message,
} from "antd";
import { ArrowLeftOutlined, UploadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { UploadFile } from "antd";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import dayjs from "dayjs";

const { Title } = Typography;
const { TextArea } = Input;

export const ExtendOfferPage: React.FC = () => {
	const { t } = useTranslation("candidacies");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { candidacyId } = useParams<{ candidacyId: string }>();
	const [form] = Form.useForm();
	const [fileList, setFileList] = useState<UploadFile[]>([]);
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (values: {
		salary_currency?: string;
		salary_amount?: number;
		start_date?: ReturnType<typeof dayjs>;
		notes?: string;
	}) => {
		if (!sessionToken || !candidacyId) return;
		const offerFile = fileList[0]?.originFileObj;
		if (!offerFile) {
			message.error("Offer letter PDF is required");
			return;
		}

		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const formData = new FormData();
			formData.append("candidacy_id", candidacyId);
			formData.append("offer_letter", offerFile);
			if (values.salary_currency)
				formData.append("salary_currency", values.salary_currency);
			if (values.salary_amount !== undefined)
				formData.append("salary_amount", String(values.salary_amount));
			if (values.start_date)
				formData.append("start_date", values.start_date.format("YYYY-MM-DD"));
			if (values.notes) formData.append("notes", values.notes);

			const res = await fetch(`${apiBaseUrl}/org/extend-offer`, {
				method: "POST",
				headers: { Authorization: `Bearer ${sessionToken}` },
				body: formData,
			});

			if (res.status === 201) {
				message.success("Offer extended");
				navigate(`/candidacies/${candidacyId}`);
			} else if (res.status === 422) {
				message.error("Candidacy is not in interviewing state");
			} else if (res.status === 400) {
				message.error("Invalid offer letter file (must be PDF)");
			} else {
				message.error("Failed to extend offer");
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
					<Button icon={<ArrowLeftOutlined />}>{t("backToCandidacies")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("extendOffer")}
			</Title>

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					<Form.Item label="Offer letter (PDF only, ≤5 MB)" required>
						<Upload
							beforeUpload={() => false}
							fileList={fileList}
							onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
							accept=".pdf"
							maxCount={1}
						>
							<Button icon={<UploadOutlined />}>Select PDF</Button>
						</Upload>
					</Form.Item>

					<Form.Item name="salary_currency" label="Currency (e.g. USD)">
						<Input maxLength={3} style={{ width: 100 }} />
					</Form.Item>

					<Form.Item name="salary_amount" label="Amount">
						<InputNumber style={{ width: 200 }} min={0} />
					</Form.Item>

					<Form.Item name="start_date" label="Start date">
						<DatePicker style={{ width: "100%" }} />
					</Form.Item>

					<Form.Item name="notes" label="Notes (max 4000 chars)">
						<TextArea rows={4} maxLength={4000} showCount />
					</Form.Item>

					<Form.Item>
						<Button
							type="primary"
							htmlType="submit"
							loading={submitting}
							disabled={fileList.length === 0}
						>
							{t("extendOffer")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};
