import { Form, Input, Button, Alert } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
	EMAIL_MIN_LENGTH,
	EMAIL_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
} from "vetchium-specs/common/common";
import { useAuth } from "../contexts/AuthContext";

interface LoginFormValues {
	email: string;
	password: string;
}

export function LoginForm() {
	const { t } = useTranslation("auth");
	const { login, loading, error } = useAuth();

	const handleFinish = async (values: LoginFormValues) => {
		await login(values.email, values.password);
	};

	return (
		<Form<LoginFormValues>
			name="login"
			onFinish={handleFinish}
			layout="vertical"
			requiredMark={false}
		>
			{error && (
				<Alert
					message={error}
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
						message: t("login.passwordMinLength", { min: PASSWORD_MIN_LENGTH }),
					},
					{
						max: PASSWORD_MAX_LENGTH,
						message: t("login.passwordMaxLength", { max: PASSWORD_MAX_LENGTH }),
					},
				]}
			>
				<Input.Password
					prefix={<LockOutlined />}
					placeholder={t("login.password")}
					size="large"
				/>
			</Form.Item>

			<Form.Item>
				<Button
					type="primary"
					htmlType="submit"
					loading={loading}
					block
					size="large"
				>
					{t("login.submit")}
				</Button>
			</Form.Item>
		</Form>
	);
}
