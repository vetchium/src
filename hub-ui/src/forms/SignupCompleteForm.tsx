import { useState, useEffect } from "react";
import {
	Form,
	Input,
	Button,
	Alert,
	Select,
	Space,
	Spin,
	Steps,
	Typography,
	Descriptions,
	Card,
	Tooltip,
} from "antd";
import {
	LockOutlined,
	MinusCircleOutlined,
	PlusOutlined,
	InfoCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
	validatePassword,
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
} from "vetchium-specs/common/common";
import {
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
import { useAuth } from "../hooks/useAuth";

const { Text } = Typography;

interface SignupCompleteFormProps {
	signupToken: string;
}

// UI-specific form values type - includes confirm_password for validation
// and uses simplified display_names structure for Form.List
interface SignupCompleteFormValues {
	password: string;
	confirm_password: string;
	display_names?: Array<{
		language_code: string;
		display_name: string;
	}>;
	home_region: string;
	preferred_language: string;
	resident_country_code: string;
}

export function SignupCompleteForm({ signupToken }: SignupCompleteFormProps) {
	const { t, i18n } = useTranslation(["signup", "common"]);
	const navigate = useNavigate();
	const { setAuthData } = useAuth();
	const [form] = Form.useForm<SignupCompleteFormValues>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [regions, setRegions] = useState<Region[]>([]);
	const [languages, setLanguages] = useState<SupportedLanguage[]>([]);
	const [loadingData, setLoadingData] = useState(true);
	const [currentStep, setCurrentStep] = useState(0);

	// Watch form values for summary step
	const preferredLanguage = Form.useWatch("preferred_language", form);
	const displayNames = Form.useWatch("display_names", form);
	const homeRegion = Form.useWatch("home_region", form);
	const residentCountryCode = Form.useWatch("resident_country_code", form);
	const password = Form.useWatch("password", form);

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
				}
			} catch {
				setError(t("common:serverError"));
			} finally {
				setLoadingData(false);
			}
		}

		loadData();
	}, [t]);

	const handleLanguageChange = (languageCode: string) => {
		// Update i18n locale
		i18n.changeLanguage(languageCode.replace("_", "-"));

		// Get current display_names or use default
		const currentNames = form.getFieldValue("display_names") || [];

		if (currentNames.length > 0) {
			// Filter out any additional display names that would now be duplicates
			const filteredNames = currentNames.filter(
				(
					name: { language_code: string; display_name: string },
					index: number
				) => {
					if (index === 0) return true;
					return name?.language_code !== languageCode;
				}
			);
			// Update the first entry with new language code, preserving display_name
			filteredNames[0] = {
				display_name: filteredNames[0]?.display_name || "",
				language_code: languageCode,
			};
			form.setFieldValue("display_names", filteredNames);
		} else {
			// Initialize with new entry
			form.setFieldValue("display_names", [
				{ language_code: languageCode, display_name: "" },
			]);
		}
	};

	// Fields to validate for each step
	const stepFields: string[][] = [
		["preferred_language"], // Step 0: Language
		["display_names"], // Step 1: Display names
		["home_region", "resident_country_code"], // Step 2: Region and country
		["password", "confirm_password"], // Step 3: Password
		// Step 4: Summary (no fields to validate)
	];

	const nextStep = () => {
		const fieldsToValidate = stepFields[currentStep] || [];
		form
			.validateFields(fieldsToValidate)
			.then(() => {
				setCurrentStep(currentStep + 1);
				setError(null);
			})
			.catch(() => {
				// Validation errors are shown in the form
			});
	};

	const prevStep = () => {
		setCurrentStep(currentStep - 1);
		setError(null);
	};

	const onFinish = async (values: SignupCompleteFormValues) => {
		setLoading(true);
		setError(null);

		try {
			// Validate display_names exists
			const formDisplayNames = values.display_names || [];
			if (formDisplayNames.length === 0 || !formDisplayNames[0]?.display_name) {
				setError(t("signup:atLeastOneDisplayName"));
				setLoading(false);
				return;
			}

			// Transform display_names to API format
			const preferredDisplayName = formDisplayNames[0].display_name;

			const otherNames: DisplayNameEntry[] | undefined =
				formDisplayNames.length > 1
					? formDisplayNames.slice(1).map((name) => ({
							language_code: name.language_code,
							display_name: name.display_name,
							is_preferred: false,
						}))
					: undefined;

			const request: CompleteSignupRequest = {
				signup_token: signupToken,
				password: values.password,
				preferred_display_name: preferredDisplayName,
				other_display_names: otherNames,
				home_region: values.home_region,
				preferred_language: values.preferred_language,
				resident_country_code: values.resident_country_code,
			};

			const response = await api.completeSignup(request);

			if (response.status === 201 && response.data) {
				setAuthData(response.data.session_token, response.data.handle);
				navigate("/");
			} else if (response.status === 400) {
				// Show the actual validation error from API if available
				const errorMsg = response.errors?.[0]?.message || "Validation error";
				setError(errorMsg);
			} else if (response.status === 401) {
				setError(t("signup:invalidToken"));
			} else if (response.status === 409) {
				setError(t("signup:userAlreadyExists"));
			} else {
				setError(t("common:serverError"));
			}
		} catch (err) {
			console.error("Signup error:", err);
			setError(t("common:networkError"));
		} finally {
			setLoading(false);
		}
	};

	if (loadingData) {
		return <Alert type="info" description={t("common:loading")} />;
	}

	const steps = [
		{
			title: t("signup:languageStepTitle"),
			description: t("signup:languageStepDescription"),
			content: (
				<Form.Item
					name="preferred_language"
					label={t("signup:preferredLanguageLabel")}
					rules={[{ required: true, message: t("common:required") }]}
					style={{ marginTop: 16 }}
				>
					<Select
						placeholder={t("signup:preferredLanguagePlaceholder")}
						size="large"
						onChange={handleLanguageChange}
						options={languages.map((lang) => ({
							label: `${lang.native_name} (${lang.language_name})`,
							value: lang.language_code,
						}))}
					/>
				</Form.Item>
			),
		},
		{
			title: t("signup:displayNameStepTitle"),
			description: t("signup:displayNameStepDescription"),
			content: (
				<Form.Item
					label={t("signup:displayNameLabel")}
					required
					style={{ marginTop: 16 }}
				>
					<Form.List
						name="display_names"
						rules={[
							{
								validator: async (_, names) => {
									if (!names || names.length < 1) {
										return Promise.reject(
											new Error(t("signup:atLeastOneDisplayName"))
										);
									}
								},
							},
						]}
					>
						{(fields, { add, remove }) => (
							<>
								{fields.map((field, index) => (
									<Space
										key={field.key}
										style={{ display: "flex", marginBottom: 8 }}
										align="baseline"
									>
										<Form.Item
											name={[field.name, "language_code"]}
											rules={[
												{ required: true, message: t("common:required") },
												({ getFieldValue }) => ({
													validator(_, value) {
														if (!value) return Promise.resolve();

														const displayNames =
															getFieldValue("display_names") || [];
														const duplicateCount = displayNames.filter(
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
												disabled={index === 0}
												options={languages.map((lang) => ({
													label: `${lang.native_name} (${lang.language_name})`,
													value: lang.language_code,
												}))}
											/>
										</Form.Item>
										<Form.Item
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
										{index > 0 && (
											<MinusCircleOutlined onClick={() => remove(field.name)} />
										)}
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
				</Form.Item>
			),
		},
		{
			title: t("signup:regionStepTitle"),
			description: t("signup:regionStepDescription"),
			content: (
				<>
					<Form.Item
						name="home_region"
						label={
							<span>
								{t("signup:regionLabel")}{" "}
								<Tooltip title={t("signup:regionHelp")}>
									<InfoCircleOutlined
										style={{ color: "#1890ff", cursor: "help" }}
									/>
								</Tooltip>
							</span>
						}
						rules={[{ required: true, message: t("common:required") }]}
						style={{ marginTop: 16 }}
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
						name="resident_country_code"
						label={
							<span>
								{t("signup:countryLabel")}{" "}
								<Tooltip title={t("signup:countryHelp")}>
									<InfoCircleOutlined
										style={{ color: "#1890ff", cursor: "help" }}
									/>
								</Tooltip>
							</span>
						}
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
							showSearch={{
								filterOption: (input, option) =>
									(option?.label ?? "")
										.toLowerCase()
										.includes(input.toLowerCase()),
							}}
							options={COUNTRIES.map((country) => ({
								label: country.name,
								value: country.code,
							}))}
						/>
					</Form.Item>
				</>
			),
		},
		{
			title: t("signup:passwordStepTitle"),
			description: t("signup:passwordStepDescription"),
			content: (
				<>
					<Form.Item
						name="password"
						label={t("signup:passwordLabel")}
						validateFirst
						rules={[
							{ required: true, message: t("common:required") },
							{
								min: PASSWORD_MIN_LENGTH,
								message: t("common:invalidPassword"),
							},
							{
								max: PASSWORD_MAX_LENGTH,
								message: t("common:invalidPassword"),
							},
							{
								validator: (_, value) => {
									if (!value) return Promise.resolve();
									const err = validatePassword(value);
									if (err) return Promise.reject(new Error(err));
									return Promise.resolve();
								},
							},
						]}
						style={{ marginTop: 16 }}
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
									return Promise.reject(
										new Error(t("signup:passwordMismatch"))
									);
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
				</>
			),
		},
		{
			title: t("signup:summaryStepTitle"),
			description: t("signup:summaryStepDescription"),
			content: null, // Rendered separately below
		},
	];

	// Summary step content - uses watched form values for reactivity
	const renderSummaryContent = () => {
		const selectedLanguage = languages.find(
			(lang) => lang.language_code === preferredLanguage
		);
		const selectedRegion = regions.find(
			(region) => region.region_code === homeRegion
		);
		const selectedCountry = COUNTRIES.find(
			(country) => country.code === residentCountryCode
		);

		return (
			<Card style={{ marginTop: 16 }}>
				<Descriptions column={1} bordered>
					<Descriptions.Item label={t("signup:preferredLanguageLabel")}>
						{selectedLanguage
							? `${selectedLanguage.native_name} (${selectedLanguage.language_name})`
							: "-"}
					</Descriptions.Item>
					<Descriptions.Item label={t("signup:displayNameLabel")}>
						{displayNames && displayNames.length > 0 ? (
							<ul style={{ margin: 0, paddingLeft: 20 }}>
								{displayNames.map(
									(
										name: { language_code: string; display_name: string },
										index: number
									) => {
										const lang = languages.find(
											(l) => l.language_code === name?.language_code
										);
										return (
											<li key={index}>
												{name?.display_name || "-"}{" "}
												{lang && (
													<Text type="secondary">({lang.native_name})</Text>
												)}
												{index === 0 && (
													<Text type="secondary">
														{" "}
														- {t("signup:preferred")}
													</Text>
												)}
											</li>
										);
									}
								)}
							</ul>
						) : (
							"-"
						)}
					</Descriptions.Item>
					<Descriptions.Item label={t("signup:regionLabel")}>
						{selectedRegion ? selectedRegion.region_name : "-"}
					</Descriptions.Item>
					<Descriptions.Item label={t("signup:countryLabel")}>
						{selectedCountry ? selectedCountry.name : "-"}
					</Descriptions.Item>
					<Descriptions.Item label={t("signup:passwordLabel")}>
						{password ? "••••••••" : "-"}
					</Descriptions.Item>
				</Descriptions>
			</Card>
		);
	};

	return (
		<Spin spinning={loading}>
			{error && (
				<Alert
					description={error}
					type="error"
					showIcon
					style={{ marginBottom: 16 }}
					closable={{ onClose: () => setError(null) }}
				/>
			)}

			<Form
				form={form}
				name="signup-complete"
				onFinish={onFinish}
				layout="vertical"
				preserve={true}
				initialValues={{
					display_names: [{ language_code: "", display_name: "" }],
				}}
			>
				<Steps
					current={currentStep}
					size="small"
					items={steps.map((step) => ({
						title: step.title,
					}))}
					style={{ marginBottom: 24 }}
				/>

				{/* Keep all steps mounted but hidden to preserve form values */}
				{steps.map((step, index) => (
					<div
						key={index}
						style={{
							display: index === currentStep ? "block" : "none",
						}}
					>
						{index === steps.length - 1 ? renderSummaryContent() : step.content}
					</div>
				))}

				<div style={{ marginTop: 24, display: "flex", gap: 8 }}>
					{currentStep > 0 && (
						<Button onClick={prevStep} disabled={loading}>
							{t("signup:previous")}
						</Button>
					)}
					{currentStep < steps.length - 1 && (
						<Button type="primary" onClick={nextStep}>
							{t("signup:next")}
						</Button>
					)}
					{currentStep === steps.length - 1 && (
						<Button type="primary" htmlType="submit" disabled={loading}>
							{t("signup:completeButton")}
						</Button>
					)}
				</div>
			</Form>
		</Spin>
	);
}
