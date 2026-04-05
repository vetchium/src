import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Spin, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	ApplyProviderEnrollmentRequest,
	MarketplaceEnrollment,
	ReapplyProviderEnrollmentRequest,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;
const { TextArea } = Input;

export function MarketplaceProvideApplyPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();
	const { capability_slug } = useParams<{ capability_slug: string }>();

	const [existingEnrollment, setExistingEnrollment] =
		useState<MarketplaceEnrollment | null>(null);
	const [loadingEnrollment, setLoadingEnrollment] = useState(false);
	const [submitLoading, setSubmitLoading] = useState(false);
	const [form] = Form.useForm();

	const loadEnrollment = useCallback(async () => {
		if (!sessionToken || !capability_slug) return;
		setLoadingEnrollment(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/provider-enrollments/get`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ capability_slug }),
				}
			);
			if (resp.status === 200) {
				const data: MarketplaceEnrollment = await resp.json();
				setExistingEnrollment(data);
				form.setFieldsValue({
					application_note: data.application_note ?? "",
				});
			} else {
				setExistingEnrollment(null);
			}
		} catch {
			message.error(t("provideApply.errors.loadFailed"));
		} finally {
			setLoadingEnrollment(false);
		}
	}, [sessionToken, capability_slug, message, t, form]);

	useEffect(() => {
		loadEnrollment();
	}, [loadEnrollment]);

	const isReapply =
		existingEnrollment?.status === "rejected" ||
		existingEnrollment?.status === "expired";

	const handleSubmit = async (values: { application_note?: string }) => {
		if (!sessionToken || !capability_slug) return;
		setSubmitLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const endpoint = isReapply
				? `${baseUrl}/org/marketplace/provider-enrollments/reapply`
				: `${baseUrl}/org/marketplace/provider-enrollments/apply`;
			const req:
				| ApplyProviderEnrollmentRequest
				| ReapplyProviderEnrollmentRequest = {
				capability_slug,
				...(values.application_note
					? { application_note: values.application_note }
					: {}),
			};
			const resp = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200 || resp.status === 201) {
				message.success(t("provideApply.success.applied"));
				navigate(`/marketplace/provide/${capability_slug}`);
			} else {
				message.error(t("provideApply.errors.submitFailed"));
			}
		} catch {
			message.error(t("provideApply.errors.submitFailed"));
		} finally {
			setSubmitLoading(false);
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
				<Link to={`/marketplace/provide/${capability_slug}`}>
					<Button icon={<ArrowLeftOutlined />}>
						{t("provideApply.backToCapability")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{isReapply
					? t("provideApply.reapplyTitle")
					: t("provideApply.applyTitle")}
			</Title>

			<Spin spinning={loadingEnrollment}>
				<div style={{ maxWidth: 640 }}>
					<Form form={form} layout="vertical" onFinish={handleSubmit}>
						<Form.Item
							name="application_note"
							label={t("provideApply.applicationNoteLabel")}
							help={t("provideApply.applicationNoteHelp")}
							rules={[
								{
									max: 1000,
									message: t("provideApply.errors.noteTooLong"),
								},
							]}
						>
							<TextArea
								rows={5}
								placeholder={t("provideApply.applicationNotePlaceholder")}
							/>
						</Form.Item>

						<Form.Item shouldUpdate>
							{() => (
								<Button
									type="primary"
									htmlType="submit"
									loading={submitLoading}
									disabled={form
										.getFieldsError()
										.some(({ errors }) => errors.length > 0)}
								>
									{t("provideApply.submitButton")}
								</Button>
							)}
						</Form.Item>
					</Form>
				</div>
			</Spin>
		</div>
	);
}
