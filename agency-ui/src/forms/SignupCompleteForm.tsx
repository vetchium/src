import {
	Form,
	Input,
	Button,
	Alert,
	Spin,
	Select,
	Checkbox,
	Typography,
	Divider,
	Space,
} from "antd";
import {
	LockOutlined,
	CheckCircleOutlined,
	CloseCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { getApiBaseUrl } from "../config";
import {
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
	SUPPORTED_LANGUAGES,
} from "vetchium-specs/common/common";
import type {
	AgencyCompleteSignupRequest,
	AgencyGetSignupDetailsRequest,
} from "vetchium-specs/agency/agency-users";
import type { LanguageCode } from "vetchium-specs/common/common";
// @ts-expect-error - dohjs has no types
import { DNSoverHTTPS } from "dohjs";

const { Text, Paragraph } = Typography;

interface SignupCompleteFormValues {
	password: string;
	confirmPassword: string;
	preferred_language: LanguageCode;
	has_added_dns_record: boolean;
	agrees_to_eula: boolean;
}

const SESSION_COOKIE_NAME = "vetchium_agency_session";

function setSessionToken(token: string): void {
	const expires = new Date();
	expires.setTime(expires.getTime() + 24 * 60 * 60 * 1000);
	document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`;
}

export function SignupCompleteForm() {
	const { t, i18n } = useTranslation("auth");
	const [form] = Form.useForm<SignupCompleteFormValues>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const [domain, setDomain] = useState<string | null>(null);
	const [dnsStatus, setDnsStatus] = useState<
		"idle" | "checking" | "found" | "not-found"
	>("idle");
	const [dnsCheckError, setDnsCheckError] = useState<string | null>(null);

	const token = searchParams.get("token");

	// Get domain from token
	useEffect(() => {
		if (!token) {
			setError(t("signupComplete.missingToken"));
			return;
		}

		const fetchDomain = async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const request: AgencyGetSignupDetailsRequest = {
					signup_token: token,
				};

				const response = await fetch(
					`${apiBaseUrl}/agency/get-signup-details`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(request),
					}
				);

				if (response.status === 200) {
					const data = await response.json();
					setDomain(data.domain);
				} else if (response.status === 404) {
					setError(t("signupComplete.tokenExpired"));
				} else {
					setError(t("signupComplete.failed"));
				}
			} catch (err) {
				console.error("Failed to fetch domain:", err);
				setError(t("signupComplete.networkError"));
			}
		};

		fetchDomain();
	}, [token, t]);

	// Set default language to current UI language
	useEffect(() => {
		const currentLang = i18n.language as LanguageCode;
		if (SUPPORTED_LANGUAGES.includes(currentLang as any)) {
			form.setFieldValue("preferred_language", currentLang);
		} else {
			form.setFieldValue("preferred_language", "en-US");
		}
	}, [form, i18n.language]);

	const checkDNS = async () => {
		if (!domain) return;

		setDnsStatus("checking");
		setDnsCheckError(null);

		try {
			const doh = new DNSoverHTTPS({
				url: "https://cloudflare-dns.com/dns-query",
			});
			const dnsRecordName = `_vetchium-verify.${domain}`;

			const response = await doh.query(dnsRecordName, "TXT");

			// Check if any TXT records exist
			if (response?.answers && response.answers.length > 0) {
				const hasTxtRecord = response.answers.some(
					(answer: any) => answer.type === "TXT"
				);
				if (hasTxtRecord) {
					setDnsStatus("found");
					setDnsCheckError(null);
				} else {
					setDnsStatus("not-found");
					setDnsCheckError(t("signupComplete.dnsNotFound"));
				}
			} else {
				setDnsStatus("not-found");
				setDnsCheckError(t("signupComplete.dnsNotFound"));
			}
		} catch (err) {
			console.error("DNS check error:", err);
			setDnsStatus("not-found");
			setDnsCheckError(t("signupComplete.dnsNotFound"));
		}
	};

	const handleSubmit = async (values: SignupCompleteFormValues) => {
		if (!token) {
			setError(t("signupComplete.missingToken"));
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: AgencyCompleteSignupRequest = {
				signup_token: token,
				password: values.password,
				preferred_language: values.preferred_language,
				has_added_dns_record: values.has_added_dns_record,
				agrees_to_eula: values.agrees_to_eula,
			};

			const response = await fetch(`${apiBaseUrl}/agency/complete-signup`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
			});

			if (response.status === 201) {
				const data = await response.json();
				setSessionToken(data.session_token);
				// Reload to trigger auth state update
				window.location.href = "/";
				return;
			}

			if (response.status === 400) {
				const errors = await response.json();
				if (Array.isArray(errors)) {
					const errorMessages = errors
						.map(
							(e: { field: string; message: string }) =>
								`${e.field}: ${e.message}`
						)
						.join(", ");
					setError(errorMessages);
				} else {
					setError(t("errors.invalidRequest"));
				}
				return;
			}

			if (response.status === 404) {
				setError(t("signupComplete.tokenExpired"));
				return;
			}

			if (response.status === 422) {
				setError(t("signupComplete.dnsNotVerified"));
				return;
			}

			setError(t("signupComplete.failed"));
		} catch (err) {
			if (err instanceof Error && err.message === "Failed to fetch") {
				setError(t("signupComplete.networkError"));
			} else {
				setError(
					err instanceof Error ? err.message : t("signupComplete.failed")
				);
			}
		} finally {
			setLoading(false);
		}
	};

	const clearError = () => setError(null);

	return (
		<Spin spinning={loading}>
			<Form
				form={form}
				name="signupComplete"
				onFinish={handleSubmit}
				layout="vertical"
				requiredMark={false}
			>
				{error && (
					<Alert
						type="error"
						description={error}
						closable={{ afterClose: clearError }}
						style={{ marginBottom: 16 }}
					/>
				)}

				{domain && (
					<>
						<Form.Item label={t("signupComplete.domainTitle")}>
							<Input
								value={domain}
								readOnly
								size="large"
								style={{ fontWeight: 600, cursor: "default" }}
							/>
						</Form.Item>

						<Alert
							type="info"
							message={t("signupComplete.dnsInstructions")}
							description={
								<>
									<Paragraph style={{ marginBottom: 8 }}>
										{t("signupComplete.dnsInstructionsText", { domain })}
									</Paragraph>
									<Space direction="vertical" style={{ width: "100%" }}>
										<Button
											onClick={checkDNS}
											loading={dnsStatus === "checking"}
										>
											{t("signupComplete.checkDnsButton")}
										</Button>
										{dnsStatus === "found" && (
											<Alert
												type="success"
												message={t("signupComplete.dnsVerified")}
												icon={<CheckCircleOutlined />}
												showIcon
											/>
										)}
										{dnsStatus === "not-found" && dnsCheckError && (
											<>
												<Alert
													type="warning"
													message={dnsCheckError}
													icon={<CloseCircleOutlined />}
													showIcon
												/>
												<Alert
													type="info"
													message={t("signupComplete.dnsPropagationWarning")}
													showIcon
												/>
											</>
										)}
									</Space>
								</>
							}
							style={{ marginBottom: 16 }}
						/>

						<Divider />
					</>
				)}

				<Form.Item
					name="preferred_language"
					label={t("signupComplete.languageLabel")}
					rules={[
						{
							required: true,
							message: t("signupComplete.languageRequired"),
						},
					]}
				>
					<Select size="large">
						<Select.Option value="en-US">English (US)</Select.Option>
						<Select.Option value="de-DE">Deutsch (Deutschland)</Select.Option>
						<Select.Option value="ta-IN">தமிழ் (இந்தியா)</Select.Option>
					</Select>
				</Form.Item>

				<Form.Item
					name="password"
					label={t("signupComplete.password")}
					rules={[
						{
							required: true,
							message: t("signupComplete.passwordRequired"),
						},
						{
							min: PASSWORD_MIN_LENGTH,
							message: t("signupComplete.passwordMinLength", {
								min: PASSWORD_MIN_LENGTH,
							}),
						},
						{
							max: PASSWORD_MAX_LENGTH,
							message: t("signupComplete.passwordMaxLength", {
								max: PASSWORD_MAX_LENGTH,
							}),
						},
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("signupComplete.password")}
						size="large"
						autoComplete="new-password"
					/>
				</Form.Item>

				<Form.Item
					name="confirmPassword"
					label={t("signupComplete.confirmPassword")}
					dependencies={["password"]}
					rules={[
						{
							required: true,
							message: t("signupComplete.confirmPasswordRequired"),
						},
						({ getFieldValue }) => ({
							validator(_, value) {
								if (!value || getFieldValue("password") === value) {
									return Promise.resolve();
								}
								return Promise.reject(
									new Error(t("signupComplete.passwordMismatch"))
								);
							},
						}),
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("signupComplete.confirmPassword")}
						size="large"
						autoComplete="new-password"
					/>
				</Form.Item>

				<Form.Item
					name="has_added_dns_record"
					valuePropName="checked"
					rules={[
						{
							validator: (_, value) =>
								value
									? Promise.resolve()
									: Promise.reject(
											new Error(t("signupComplete.dnsRecordCheckboxRequired"))
										),
						},
					]}
				>
					<Checkbox>{t("signupComplete.dnsRecordCheckbox")}</Checkbox>
				</Form.Item>

				<Form.Item
					name="agrees_to_eula"
					valuePropName="checked"
					rules={[
						{
							validator: (_, value) =>
								value
									? Promise.resolve()
									: Promise.reject(
											new Error(t("signupComplete.eulaCheckboxRequired"))
										),
						},
					]}
				>
					<Checkbox>
						{t("signupComplete.eulaCheckbox")}{" "}
						<Link to="/eula" target="_blank">
							({t("signupComplete.eulaLink")})
						</Link>
					</Checkbox>
				</Form.Item>

				<Form.Item shouldUpdate>
					{() => (
						<Button
							type="primary"
							htmlType="submit"
							size="large"
							block
							disabled={
								!token ||
								!form.isFieldsTouched(["password", "confirmPassword"], true) ||
								form.getFieldsError().some(({ errors }) => errors.length > 0)
							}
						>
							{t("signupComplete.submit")}
						</Button>
					)}
				</Form.Item>
			</Form>
		</Spin>
	);
}
