import React, { useState } from "react";
import {
	Button,
	DatePicker,
	Form,
	Input,
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
		start_date?: ReturnType<typeof dayjs>;
		notes?: string;
	}) => {
		if (!sessionToken || !candidacyId) return;
		const offerFile = fileList[0]?.originFileObj;
		if (!offerFile) {
			message.error(t("offerFileRequired"));
			return;
		}

		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const formData = new FormData();
			formData.append("candidacy_id", candidacyId);
			formData.append("offer_letter", offerFile);
			if (values.start_date)
				formData.append("start_date", values.start_date.format("YYYY-MM-DD"));
			if (values.notes) formData.append("notes", values.notes);

			const res = await fetch(`${apiBaseUrl}/org/extend-offer`, {
				method: "POST",
				headers: { Authorization: `Bearer ${sessionToken}` },
				body: formData,
			});

			if (res.status === 201) {
				message.success(t("offerExtended"));
				navigate(`/candidacies/${candidacyId}`);
			} else if (res.status === 422) {
				message.error(t("notInterviewing"));
			} else if (res.status === 400) {
				message.error(t("offerFileInvalid"));
			} else {
				message.error(t("offerFailed"));
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
					<Form.Item
						label={t("offerFileLabel")}
						required
						extra={t("offerFileHelp")}
					>
						<Upload
							beforeUpload={() => false}
							fileList={fileList}
							onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
							accept=".pdf,.md,.markdown"
							maxCount={1}
						>
							<Button icon={<UploadOutlined />}>{t("offerFileSelect")}</Button>
						</Upload>
					</Form.Item>

					<Form.Item name="start_date" label={t("startDate")}>
						<DatePicker style={{ width: "100%" }} />
					</Form.Item>

					<Form.Item name="notes" label={t("notesLabel")}>
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
