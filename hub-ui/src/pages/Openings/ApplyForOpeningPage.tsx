import React, { useEffect, useState } from "react";
import {
	Button,
	Divider,
	Form,
	Input,
	Select,
	Spin,
	Typography,
	Upload,
	message,
} from "antd";
import { ArrowLeftOutlined, UploadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
	Link,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router-dom";
import type { UploadFile } from "antd";
import type {
	ListConnectionsRequest,
	ListConnectionsResponse,
} from "vetchium-specs/hub/connections";
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
	const [searchParams] = useSearchParams();
	const [coverLetter, setCoverLetter] = useState("");
	const [fileList, setFileList] = useState<UploadFile[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [form] = Form.useForm();
	// #6 — seek endorsements while applying.
	const [endorserOptions, setEndorserOptions] = useState<
		{ value: string; label: string }[]
	>([]);
	const [selectedEndorsers, setSelectedEndorsers] = useState<string[]>([]);

	useEffect(() => {
		const loadConnections = async () => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListConnectionsRequest = { limit: 100 };
				const res = await fetch(`${apiBaseUrl}/hub/connections/list`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data = (await res.json()) as ListConnectionsResponse;
					setEndorserOptions(
						data.connections.map((c) => ({
							value: c.handle,
							label: `${c.display_name} (@${c.handle})`,
						}))
					);
				}
			} catch {
				// best-effort
			}
		};
		loadConnections();
	}, [sessionToken]);

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
			selectedEndorsers.forEach((h) => formData.append("endorser_handles", h));
			// Agency attribution: ?via=<agency_domain> carried from the referral
			// inbox marks this application as represented by that agency; otherwise
			// the application is direct.
			const via = searchParams.get("via");
			formData.append("apply_via", via && via !== "" ? via : "direct");
			if (!via) {
				// Going direct: affirm no agency referred (no-op when none did).
				formData.append("direct_no_agency_affirmation", "true");
			}

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
							accept=".pdf,.docx,.md,.markdown"
							maxCount={1}
						>
							<Button icon={<UploadOutlined />}>{t("resume")}</Button>
						</Upload>
					</Form.Item>

					<Divider>{t("seekEndorsementsTitle")}</Divider>

					<Form.Item
						label={t("nominateEndorsers")}
						help={
							endorserOptions.length === 0
								? t("noConnectionsToEndorse")
								: t("nominateEndorsersHelp")
						}
					>
						<Select
							mode="multiple"
							value={selectedEndorsers}
							onChange={setSelectedEndorsers}
							options={endorserOptions}
							showSearch={{ optionFilterProp: "label" }}
							maxCount={10}
							disabled={endorserOptions.length === 0}
							placeholder={t("nominateEndorsersPlaceholder")}
						/>
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
