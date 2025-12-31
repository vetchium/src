import { useState } from "react";
import { Form, Input, Button, Alert, Spin } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
	validateEmailAddress,
	EMAIL_MIN_LENGTH,
	EMAIL_MAX_LENGTH,
} from "vetchium-specs/common/common";
import { isCommonDomain } from "vetchium-specs/hub/hub-users";
import * as api from "../lib/api-client";

interface SignupRequestFormProps {
	onSuccess?: () => void;
}

export function SignupRequestForm({ onSuccess }: SignupRequestFormProps) {
	const { t } = useTranslation(["signup", "common"]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [showCommonDomainWarning, setShowCommonDomainWarning] = useState(false);
	const [form] = Form.useForm();

	const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const email = e.target.value;
		setShowCommonDomainWarning(isCommonDomain(email));
		setError(null);
	};

	const onFinish = async (values: { email: string }) => {
		setLoading(true);
		setError(null);

		try {
			const response = await api.requestSignup(values.email);

			if (response.status === 200) {
				setSuccess(true);
				if (onSuccess) {
					onSuccess();
				}
			} else if (response.status === 400) {
				setError(t("common:invalidEmail"));
			} else if (response.status === 403) {
				setError(t("signup:unapprovedDomainError"));
			} else if (response.status === 409) {
				setError(t("signup:emailAlreadyRegistered"));
			} else {
				setError(t("common:serverError"));
			}
		} catch {
			setError(t("common:networkError"));
		} finally {
			setLoading(false);
		}
	};

	if (success) {
		return (
			<Alert
				description={t("signup:verificationEmailSent")}
				type="success"
				showIcon
			/>
		);
	}

	return (
		<Spin spinning={loading}>
			<Form
				form={form}
				name="signup-request"
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

				{showCommonDomainWarning && (
					<Alert
						description={t("signup:commonDomainWarning")}
						type="warning"
						showIcon
						style={{ marginBottom: 16 }}
					/>
				)}

				<Form.Item
					name="email"
					label={t("signup:emailLabel")}
					validateFirst
					rules={[
						{ required: true, message: t("common:required") },
						{ type: "email", message: t("common:invalidEmail") },
						{
							min: EMAIL_MIN_LENGTH,
							message: t("common:invalidEmail"),
						},
						{
							max: EMAIL_MAX_LENGTH,
							message: t("common:invalidEmail"),
						},
						{
							validator: (_, value) => {
								if (!value) return Promise.resolve();
								const err = validateEmailAddress(value);
								if (err) return Promise.reject(new Error(err));
								return Promise.resolve();
							},
						},
					]}
				>
					<Input
						prefix={<UserOutlined />}
						placeholder={t("signup:emailPlaceholder")}
						size="large"
						onChange={handleEmailChange}
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
							{t("signup:requestButton")}
						</Button>
					)}
				</Form.Item>
			</Form>
		</Spin>
	);
}
