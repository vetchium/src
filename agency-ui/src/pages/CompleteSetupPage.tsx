import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import {
	Form,
	Input,
	Button,
	Card,
	Typography,
	Alert,
	Select,
	Spin,
	message,
} from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { AgencyCompleteSetupRequest } from "vetchium-specs/agency/agency-users";
import {
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
} from "vetchium-specs/common/common";
import { getApiBaseUrl } from "../config";
import { SUPPORTED_LANGUAGES } from "../i18n";

const { Title, Text } = Typography;

export function CompleteSetupPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { t } = useTranslation("auth");
	const token = searchParams.get("token");
	const [form] = Form.useForm();

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!token) {
		return (
			<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
				<Alert
					title={t("completeSetup.invalidLinkTitle")}
					description={t("completeSetup.invalidLinkDescription")}
					type="error"
					showIcon
				/>
				<div style={{ marginTop: 24, textAlign: "center" }}>
					<Link to="/login">
						<Button type="primary">{t("completeSetup.goToLogin")}</Button>
					</Link>
				</div>
			</Card>
		);
	}

	const onFinish = async (values: {
		password: string;
		fullName: string;
		preferredLanguage?: string;
	}) => {
		setLoading(true);
		setError(null);

		try {
			const request: AgencyCompleteSetupRequest = {
				invitation_token: token,
				password: values.password,
				full_name: values.fullName,
				...(values.preferredLanguage && {
					preferred_language: values.preferredLanguage,
				}),
			};

			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/agency/complete-setup`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
			});

			if (response.ok) {
				message.success(t("completeSetup.successMessage"));
				navigate("/login");
			} else if (response.status === 400) {
				const errors: Array<{ field: string; message: string }> =
					await response.json();
				if (Array.isArray(errors) && errors.length > 0) {
					// Map API field names to form field names
					const fieldNameMap: Record<string, string> = {
						full_name: "fullName",
						password: "password",
						preferred_language: "preferredLanguage",
					};
					const formFields = errors
						.filter((e) => fieldNameMap[e.field])
						.map((e) => ({
							name: fieldNameMap[e.field],
							errors: [e.message],
						}));
					const unknownErrors = errors.filter((e) => !fieldNameMap[e.field]);
					if (formFields.length > 0) {
						form.setFields(formFields);
					}
					if (unknownErrors.length > 0) {
						setError(unknownErrors.map((e) => e.message).join(", "));
					}
				} else {
					setError(t("completeSetup.setupFailed"));
				}
			} else if (response.status === 401) {
				setError(t("completeSetup.linkExpired"));
			} else {
				setError(t("completeSetup.setupFailed"));
			}
		} catch (err) {
			setError(t("completeSetup.networkError"));
			console.error("Complete setup error:", err);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
			<div style={{ textAlign: "center", marginBottom: 24 }}>
				<Title level={3}>{t("completeSetup.title")}</Title>
				<Text type="secondary">{t("completeSetup.subtitle")}</Text>
			</div>

			{error && (
				<Alert
					title={error}
					type="error"
					showIcon
					style={{ marginBottom: 24 }}
				/>
			)}

			<Spin spinning={loading}>
				<Form
					form={form}
					name="complete_setup"
					onFinish={onFinish}
					layout="vertical"
					requiredMark={false}
				>
					<Form.Item
						name="fullName"
						label={t("completeSetup.fullNameLabel")}
						rules={[
							{ required: true, message: t("completeSetup.fullNameRequired") },
						]}
					>
						<Input
							prefix={<UserOutlined />}
							placeholder={t("completeSetup.fullNamePlaceholder")}
							size="large"
						/>
					</Form.Item>

					<Form.Item
						name="password"
						label={t("completeSetup.passwordLabel")}
						rules={[
							{
								required: true,
								message: t("completeSetup.passwordRequired"),
							},
							{
								min: PASSWORD_MIN_LENGTH,
								message: t("completeSetup.passwordMinLength", {
									min: PASSWORD_MIN_LENGTH,
								}),
							},
							{
								max: PASSWORD_MAX_LENGTH,
								message: t("completeSetup.passwordMaxLength", {
									max: PASSWORD_MAX_LENGTH,
								}),
							},
						]}
						hasFeedback
					>
						<Input.Password
							prefix={<LockOutlined />}
							placeholder={t("completeSetup.passwordNewPlaceholder")}
							size="large"
						/>
					</Form.Item>

					<Form.Item
						name="confirm"
						label={t("completeSetup.confirmPasswordLabel")}
						dependencies={["password"]}
						hasFeedback
						rules={[
							{
								required: true,
								message: t("completeSetup.confirmPasswordRequired"),
							},
							({ getFieldValue }) => ({
								validator(_, value) {
									if (!value || getFieldValue("password") === value) {
										return Promise.resolve();
									}
									return Promise.reject(
										new Error(t("completeSetup.confirmPasswordMismatch"))
									);
								},
							}),
						]}
					>
						<Input.Password
							prefix={<LockOutlined />}
							placeholder={t("completeSetup.confirmPasswordPlaceholder")}
							size="large"
						/>
					</Form.Item>

					<Form.Item
						name="preferredLanguage"
						label={t("completeSetup.preferredLanguageLabel")}
						tooltip={t("completeSetup.preferredLanguageTooltip")}
					>
						<Select
							placeholder={t("completeSetup.preferredLanguagePlaceholder")}
							allowClear
							size="large"
							options={SUPPORTED_LANGUAGES.map((lang) => ({
								label: lang,
								value: lang,
							}))}
						/>
					</Form.Item>

					<Form.Item>
						<Button
							type="primary"
							htmlType="submit"
							block
							size="large"
							loading={loading}
						>
							{t("completeSetup.submitButton")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</Card>
	);
}
