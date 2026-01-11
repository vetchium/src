import { Form, Input, Button, Alert, Spin, Select } from "antd";
import { UserOutlined, GlobalOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { getApiBaseUrl } from "../config";
import {
	EMAIL_MIN_LENGTH,
	EMAIL_MAX_LENGTH,
	isPersonalEmailDomain,
} from "vetchium-specs/common/common";
import type { OrgInitSignupRequest } from "vetchium-specs/org/org-users";
import type { Region } from "vetchium-specs/global/global";

export function SignupForm() {
	const { t } = useTranslation("auth");
	const [form] = Form.useForm<OrgInitSignupRequest>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [regions, setRegions] = useState<Region[]>([]);
	const [loadingRegions, setLoadingRegions] = useState(true);

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

	const handleSubmit = async (values: OrgInitSignupRequest) => {
		setLoading(true);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();

			const response = await fetch(`${apiBaseUrl}/org/init-signup`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(values),
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
					name="email"
					rules={[
						{ required: true, message: t("signup.emailRequired") },
						{ type: "email", message: t("signup.emailInvalid") },
						{
							min: EMAIL_MIN_LENGTH,
							message: t("signup.emailMinLength", { min: EMAIL_MIN_LENGTH }),
						},
						{
							max: EMAIL_MAX_LENGTH,
							message: t("signup.emailMaxLength", { max: EMAIL_MAX_LENGTH }),
						},
						{
							validator: (_, value) => {
								if (value && isPersonalEmailDomain(value)) {
									return Promise.reject(t("signup.emailPersonalDomain"));
								}
								return Promise.resolve();
							},
						},
					]}
				>
					<Input
						prefix={<UserOutlined />}
						placeholder={t("signup.email")}
						size="large"
						autoComplete="email"
					/>
				</Form.Item>

				<Form.Item
					name="home_region"
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
