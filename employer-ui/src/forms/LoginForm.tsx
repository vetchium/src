import { Form, Input, Button, Alert, Spin } from "antd";
import { UserOutlined, LockOutlined, GlobalOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import {
	EMAIL_MIN_LENGTH,
	EMAIL_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
	DOMAIN_MIN_LENGTH,
	DOMAIN_MAX_LENGTH,
} from "vetchium-specs/common/common";

interface LoginFormValues {
	email: string;
	domain: string;
	password: string;
}

export function LoginForm() {
	const { t } = useTranslation("auth");
	const { login, loading, error, clearError } = useAuth();
	const [form] = Form.useForm<LoginFormValues>();

	const handleSubmit = async (values: LoginFormValues) => {
		await login(values.email, values.domain, values.password);
	};

	return (
		<Spin spinning={loading}>
			<Form
				form={form}
				name="login"
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

				<Form.Item
					name="domain"
					rules={[
						{ required: true, message: t("login.domainRequired") },
						{
							min: DOMAIN_MIN_LENGTH,
							message: t("login.domainMinLength", {
								min: DOMAIN_MIN_LENGTH,
							}),
						},
						{
							max: DOMAIN_MAX_LENGTH,
							message: t("login.domainMaxLength", {
								max: DOMAIN_MAX_LENGTH,
							}),
						},
					]}
				>
					<Input
						prefix={<GlobalOutlined />}
						placeholder={t("login.domain")}
						size="large"
					/>
				</Form.Item>

				<Form.Item
					name="email"
					rules={[
						{ required: true, message: t("login.emailRequired") },
						{ type: "email", message: t("login.emailInvalid") },
						{
							min: EMAIL_MIN_LENGTH,
							message: t("login.emailMinLength", { min: EMAIL_MIN_LENGTH }),
						},
						{
							max: EMAIL_MAX_LENGTH,
							message: t("login.emailMaxLength", { max: EMAIL_MAX_LENGTH }),
						},
					]}
				>
					<Input
						prefix={<UserOutlined />}
						placeholder={t("login.email")}
						size="large"
						autoComplete="email"
					/>
				</Form.Item>

				<Form.Item
					name="password"
					rules={[
						{ required: true, message: t("login.passwordRequired") },
						{
							min: PASSWORD_MIN_LENGTH,
							message: t("login.passwordMinLength", {
								min: PASSWORD_MIN_LENGTH,
							}),
						},
						{
							max: PASSWORD_MAX_LENGTH,
							message: t("login.passwordMaxLength", {
								max: PASSWORD_MAX_LENGTH,
							}),
						},
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("login.password")}
						size="large"
						autoComplete="current-password"
					/>
				</Form.Item>

				<div style={{ textAlign: "right", marginBottom: 24 }}>
					<Link to="/forgot-password">
						{t("login.forgotPassword", "Forgot Password?")}
					</Link>
				</div>

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
							{t("login.submit")}
						</Button>
					)}
				</Form.Item>
			</Form>
		</Spin>
	);
}
