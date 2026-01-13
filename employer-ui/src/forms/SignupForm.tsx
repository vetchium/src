import { Form, Input, Button, Alert, Spin, Select, Space } from "antd";
import { UserOutlined, GlobalOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { getApiBaseUrl } from "../config";
import {
	DOMAIN_MIN_LENGTH,
	DOMAIN_MAX_LENGTH,
	validateDomainName,
	isPersonalEmailDomain,
} from "vetchium-specs/common/common";
import type { OrgInitSignupRequest } from "vetchium-specs/org/org-users";
import type { Region } from "vetchium-specs/global/global";

// Form values type (before transformation to API request)
interface SignupFormValues {
	domain: string;
	email_prefix: string;
	home_region: string;
}

export function SignupForm() {
	const { t } = useTranslation("auth");
	const [form] = Form.useForm<SignupFormValues>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [regions, setRegions] = useState<Region[]>([]);
	const [loadingRegions, setLoadingRegions] = useState(true);
	const [domain, setDomain] = useState<string>("");

	useEffect(() => {
		const fetchRegions = async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}/global/get-regions`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				});

				if (response.ok) {
					const data = await response.json();
					setRegions(data.regions || []);
				}
			} catch (err) {
				console.error("Failed to fetch regions:", err);
			} finally {
				setLoadingRegions(false);
			}
		};

		fetchRegions();
	}, []);

	const handleSubmit = async (values: SignupFormValues) => {
		setLoading(true);
		setError(null);

		// Construct full email from prefix and domain
		const fullEmail = `${values.email_prefix}@${values.domain}`;

		const request: OrgInitSignupRequest = {
			email: fullEmail,
			home_region: values.home_region,
		};

		try {
			const apiBaseUrl = await getApiBaseUrl();

			const response = await fetch(`${apiBaseUrl}/org/init-signup`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
			});

			if (response.status === 200) {
				setSuccess(true);
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

			if (response.status === 403) {
				setError(t("signup.domainNotApproved"));
				return;
			}

			if (response.status === 409) {
				setError(t("signup.emailAlreadyRegistered"));
				return;
			}

			setError(t("signup.failed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : t("signup.failed"));
		} finally {
			setLoading(false);
		}
	};

	const clearError = () => setError(null);

	const handleDomainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value.toLowerCase().trim();
		setDomain(value);
		form.setFieldsValue({ domain: value });
	};

	if (success) {
		return (
			<Alert
				type="success"
				title={t("signup.successTitle")}
				description={t("signup.successMessage")}
				showIcon
			/>
		);
	}

	return (
		<Spin spinning={loading || loadingRegions}>
			<Form
				form={form}
				name="signup"
				onFinish={handleSubmit}
				layout="vertical"
				requiredMark={false}
			>
				{error && (
					<Alert
						type="error"
						title={error}
						closable={{ afterClose: clearError }}
						style={{ marginBottom: 16 }}
					/>
				)}

				<Form.Item
					name="domain"
					label={t("signup.domainLabel")}
					rules={[
						{ required: true, message: t("signup.domainRequired") },
						{
							min: DOMAIN_MIN_LENGTH,
							message: t("signup.domainMinLength", {
								min: DOMAIN_MIN_LENGTH,
							}),
						},
						{
							max: DOMAIN_MAX_LENGTH,
							message: t("signup.domainMaxLength", {
								max: DOMAIN_MAX_LENGTH,
							}),
						},
						{
							validator: (_, value) => {
								if (value) {
									const domainErr = validateDomainName(value);
									if (domainErr) {
										return Promise.reject(t("signup.domainInvalid"));
									}
									// Check if it's a personal email domain
									const testEmail = `test@${value}`;
									if (isPersonalEmailDomain(testEmail)) {
										return Promise.reject(t("signup.domainPersonal"));
									}
								}
								return Promise.resolve();
							},
						},
					]}
				>
					<Input
						prefix={<GlobalOutlined />}
						placeholder={t("signup.domainPlaceholder")}
						size="large"
						onChange={handleDomainChange}
					/>
				</Form.Item>

				<Form.Item
					name="email_prefix"
					label={t("signup.emailLabel")}
					rules={[
						{ required: true, message: t("signup.emailPrefixRequired") },
						{
							pattern: /^[a-zA-Z0-9._%+-]+$/,
							message: t("signup.emailPrefixInvalid"),
						},
					]}
				>
					<Space.Compact style={{ width: "100%" }}>
						<Input
							prefix={<UserOutlined />}
							placeholder={t("signup.emailPrefixPlaceholder")}
							size="large"
							autoComplete="email"
							disabled={!domain}
							style={{ flex: 1 }}
						/>
						<Input
							style={{
								width: "auto",
								minWidth: domain ? "auto" : "40px",
								backgroundColor: "#fafafa",
								cursor: "default",
							}}
							value={domain ? `@${domain}` : "@"}
							disabled
							size="large"
							readOnly
						/>
					</Space.Compact>
				</Form.Item>

				<Form.Item
					name="home_region"
					label={t("signup.regionLabel")}
					rules={[{ required: true, message: t("signup.regionRequired") }]}
				>
					<Select
						placeholder={t("signup.region")}
						size="large"
						suffix={<GlobalOutlined />}
						options={regions.map((r) => ({
							value: r.region_code,
							label: r.region_name,
						}))}
					/>
				</Form.Item>

				<Form.Item shouldUpdate>
					{() => (
						<Button
							type="primary"
							htmlType="submit"
							size="large"
							block
							disabled={
								!form.isFieldsTouched(true) ||
								form.getFieldsError().some(({ errors }) => errors.length > 0)
							}
						>
							{t("signup.submit")}
						</Button>
					)}
				</Form.Item>
			</Form>
		</Spin>
	);
}
