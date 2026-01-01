import { useState, useEffect } from "react";
import { Form, Input, Button, Alert, Select, Space, Spin } from "antd";
import {
	LockOutlined,
	MinusCircleOutlined,
	PlusOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
	validatePassword,
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
} from "vetchium-specs/common/common";
import {
	validateDisplayName,
	validateCountryCode,
	DISPLAY_NAME_MIN_LENGTH,
	DISPLAY_NAME_MAX_LENGTH,
} from "vetchium-specs/hub/hub-users";
import type {
	CompleteSignupRequest,
	DisplayNameEntry,
} from "vetchium-specs/hub/hub-users";
import type { Region, SupportedLanguage } from "vetchium-specs/global/global";
import * as api from "../lib/api-client";
import { COUNTRIES } from "../lib/countries";
import { useAuth } from "../contexts/AuthContext";

interface SignupCompleteFormProps {
	signupToken: string;
}

export function SignupCompleteForm({ signupToken }: SignupCompleteFormProps) {
	const { t } = useTranslation(["signup", "common"]);
	const navigate = useNavigate();
	const { setAuthData } = useAuth();
	const [form] = Form.useForm();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [regions, setRegions] = useState<Region[]>([]);
	const [languages, setLanguages] = useState<SupportedLanguage[]>([]);
	const [loadingData, setLoadingData] = useState(true);

	useEffect(() => {
		// Load regions and languages
		async function loadData() {
			try {
				const [regionsResp, languagesResp] = await Promise.all([
					api.getRegions(),
					api.getSupportedLanguages(),
				]);

				if (regionsResp.status === 200 && regionsResp.data) {
					setRegions(regionsResp.data);
				}

				if (languagesResp.status === 200 && languagesResp.data) {
					setLanguages(languagesResp.data);
					// Set default language
					const defaultLang = languagesResp.data.find((l) => l.is_default);
					if (defaultLang) {
						form.setFieldValue("preferred_language", defaultLang.language_code);
						// Mark the field as touched so the submit button can be enabled
						form.setFields([
							{
								name: "preferred_language",
								touched: true,
							},
						]);
					}
				}
			} catch {
				setError(t("common:serverError"));
			} finally {
				setLoadingData(false);
			}
		}

		loadData();
	}, [form, t]);

	const onFinish = async (values: {
		password: string;
		confirm_password: string;
		preferred_display_name: string;
		other_display_names?: Array<{
			language_code: string;
			display_name: string;
		}>;
		home_region: string;
		preferred_language: string;
		resident_country_code: string;
	}) => {
		setLoading(true);
		setError(null);

		try {
			const otherNames: DisplayNameEntry[] | undefined =
				values.other_display_names?.map((name) => ({
					language_code: name.language_code,
					display_name: name.display_name,
					is_preferred: false,
				}));

			const request: CompleteSignupRequest = {
				signup_token: signupToken,
				password: values.password,
				preferred_display_name: values.preferred_display_name,
				other_display_names: otherNames,
				home_region: values.home_region,
				preferred_language: values.preferred_language,
				resident_country_code: values.resident_country_code,
			};

			const response = await api.completeSignup(request);

			if (response.status === 201 && response.data) {
				// Set auth data and redirect to home
				setAuthData(response.data.session_token, response.data.handle);
				navigate("/");
			} else if (response.status === 400) {
				setError(t("common:invalidEmail"));
			} else if (response.status === 401) {
				setError(t("signup:invalidToken"));
			} else if (response.status === 409) {
				setError(t("signup:userAlreadyExists"));
			} else {
				setError(t("common:serverError"));
			}
		} catch {
			setError(t("common:networkError"));
		} finally {
			setLoading(false);
		}
	};

	if (loadingData) {
		return <Alert type="info" description={t("common:loading")} />;
	}

	return (
		<Spin spinning={loading}>
			<Form
				form={form}
				name="signup-complete"
				onFinish={onFinish}
				layout="vertical"
			>
				{error && (
					<Alert
						description={error}
						type="error"
						showIcon
						style={{ marginBottom: 16 }}
					/>
				)}

				<Form.Item
					name="password"
					label={t("signup:passwordLabel")}
					validateFirst
					rules={[
						{ required: true, message: t("common:required") },
						{ min: PASSWORD_MIN_LENGTH, message: t("common:invalidPassword") },
						{ max: PASSWORD_MAX_LENGTH, message: t("common:invalidPassword") },
						{
							validator: (_, value) => {
								if (!value) return Promise.resolve();
								const err = validatePassword(value);
								if (err) return Promise.reject(new Error(err));
								return Promise.resolve();
							},
						},
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("signup:passwordPlaceholder")}
						size="large"
					/>
				</Form.Item>

				<Form.Item
					name="confirm_password"
					label={t("signup:confirmPasswordLabel")}
					dependencies={["password"]}
					validateFirst
					rules={[
						{ required: true, message: t("common:required") },
						({ getFieldValue }) => ({
							validator(_, value) {
								if (!value || getFieldValue("password") === value) {
									return Promise.resolve();
								}
								return Promise.reject(new Error(t("signup:passwordMismatch")));
							},
						}),
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("signup:confirmPasswordPlaceholder")}
						size="large"
					/>
				</Form.Item>

				<Form.Item
					name="preferred_display_name"
					label={t("signup:displayNameLabel")}
					validateFirst
					rules={[
						{ required: true, message: t("common:required") },
						{ min: DISPLAY_NAME_MIN_LENGTH, max: DISPLAY_NAME_MAX_LENGTH },
						{
							validator: (_, value) => {
								if (!value) return Promise.resolve();
								const err = validateDisplayName(value);
								if (err) return Promise.reject(new Error(err));
								return Promise.resolve();
							},
						},
					]}
				>
					<Input
						placeholder={t("signup:displayNamePlaceholder")}
						size="large"
					/>
				</Form.Item>

				<Form.List name="other_display_names">
					{(fields, { add, remove }) => (
						<>
							{fields.map((field) => (
								<Space
									key={field.key}
									style={{ display: "flex", marginBottom: 8 }}
									align="baseline"
								>
									<Form.Item
										{...field}
										name={[field.name, "language_code"]}
										rules={[
											{ required: true, message: t("common:required") },
											({ getFieldValue }) => ({
												validator(_, value) {
													if (!value) return Promise.resolve();

													// Check against preferred language
													const preferredLang =
														getFieldValue("preferred_language");
													if (value === preferredLang) {
														return Promise.reject(
															new Error(
																t("signup:duplicateLanguageWithPreferred")
															)
														);
													}

													// Check for duplicates in other_display_names
													const otherNames =
														getFieldValue("other_display_names") || [];
													const duplicateCount = otherNames.filter(
														(name: { language_code: string }) =>
															name?.language_code === value
													).length;

													if (duplicateCount > 1) {
														return Promise.reject(
															new Error(t("signup:duplicateLanguage"))
														);
													}

													return Promise.resolve();
												},
											}),
										]}
										style={{ marginBottom: 0, width: 200 }}
									>
										<Select
											placeholder={t("signup:languageLabel")}
											size="large"
											options={languages.map((lang) => ({
												label: `${lang.native_name} (${lang.language_name})`,
												value: lang.language_code,
											}))}
										/>
									</Form.Item>
									<Form.Item
										{...field}
										name={[field.name, "display_name"]}
										rules={[
											{ required: true, message: t("common:required") },
											{
												min: DISPLAY_NAME_MIN_LENGTH,
												max: DISPLAY_NAME_MAX_LENGTH,
											},
										]}
										style={{ marginBottom: 0, flex: 1 }}
									>
										<Input
											placeholder={t("signup:displayNamePlaceholder")}
											size="large"
										/>
									</Form.Item>
									<MinusCircleOutlined onClick={() => remove(field.name)} />
								</Space>
							))}
							<Form.Item>
								<Button
									type="dashed"
									onClick={() => add()}
									block
									icon={<PlusOutlined />}
								>
									{t("signup:addDisplayName")}
								</Button>
							</Form.Item>
						</>
					)}
				</Form.List>

				<Form.Item
					name="home_region"
					label={t("signup:regionLabel")}
					rules={[{ required: true, message: t("common:required") }]}
				>
					<Select
						placeholder={t("signup:regionPlaceholder")}
						size="large"
						options={regions.map((region) => ({
							label: region.region_name,
							value: region.region_code,
						}))}
					/>
				</Form.Item>

				<Form.Item
					name="preferred_language"
					label={t("signup:preferredLanguageLabel")}
					rules={[{ required: true, message: t("common:required") }]}
				>
					<Select
						placeholder={t("signup:preferredLanguagePlaceholder")}
						size="large"
						options={languages.map((lang) => ({
							label: `${lang.native_name} (${lang.language_name})`,
							value: lang.language_code,
						}))}
					/>
				</Form.Item>

				<Form.Item
					name="resident_country_code"
					label={t("signup:countryLabel")}
					validateFirst
					rules={[
						{ required: true, message: t("common:required") },
						{
							validator: (_, value) => {
								if (!value) return Promise.resolve();
								const err = validateCountryCode(value);
								if (err) return Promise.reject(new Error(err));
								return Promise.resolve();
							},
						},
					]}
				>
					<Select
						placeholder={t("signup:countryPlaceholder")}
						size="large"
						showSearch
						filterOption={(input, option) =>
							(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
						}
						options={COUNTRIES.map((country) => ({
							label: country.name,
							value: country.code,
						}))}
					/>
				</Form.Item>

				<Form.Item shouldUpdate style={{ marginBottom: 0 }}>
					{() => (
						<Button
							type="primary"
							htmlType="submit"
							disabled={
								!form.isFieldsTouched(true) ||
								form.getFieldsError().some(({ errors }) => errors.length > 0)
							}
							block
							size="large"
						>
							{t("signup:completeButton")}
						</Button>
					)}
				</Form.Item>
			</Form>
		</Spin>
	);
}
