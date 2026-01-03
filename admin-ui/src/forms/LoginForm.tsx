import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Spin } from "antd";
import { useTranslation } from "react-i18next";
import {
	EMAIL_MAX_LENGTH,
	EMAIL_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
} from "vetchium-specs/common/common";
import { useAuth } from "../hooks/useAuth";

interface LoginFormValues {
	email: string;
	password: string;
}

export function LoginForm() {
	const { t } = useTranslation("auth");
	const { login, loading, error } = useAuth();
	const [form] = Form.useForm<LoginFormValues>();

	const handleFinish = async (values: LoginFormValues) => {
		await login(values.email, values.password);
	};

	return (
		<Spin spinning={loading}>
			<Form<LoginFormValues>
				form={form}
				name="login"
				onFinish={handleFinish}
				layout="vertical"
				requiredMark={false}
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
					name="email"
					validateFirst
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
					/>
				</Form.Item>

				<Form.Item
					name="password"
					validateFirst
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
							{t("login.submit")}
						</Button>
					)}
				</Form.Item>
			</Form>
		</Spin>
	);
}
