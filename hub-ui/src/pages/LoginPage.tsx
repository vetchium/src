import {
	Layout,
	Card,
	Form,
	Input,
	Button,
	Typography,
	Alert,
	Spin,
} from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import {
	EMAIL_MIN_LENGTH,
	EMAIL_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
} from "vetchium-specs/common/common";
import { useAuth } from "../hooks/useAuth";

const { Content } = Layout;
const { Title, Text } = Typography;

interface LoginFormValues {
	email: string;
	password: string;
}

export function LoginPage() {
	const { t } = useTranslation(["common", "signup", "auth"]);
	const { login, loading, error, authState } = useAuth();
	const navigate = useNavigate();
	const [form] = Form.useForm<LoginFormValues>();

	useEffect(() => {
		if (authState === "authenticated") {
			navigate("/");
		} else if (authState === "tfa") {
			navigate("/tfa");
		}
	}, [authState, navigate]);

	const handleFinish = async (values: LoginFormValues) => {
		await login(values.email, values.password);
	};

	return (
		<Layout style={{ minHeight: "100vh" }}>
			<Content
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
				}}
			>
				<Card style={{ width: 400 }}>
					<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
						{t("auth:login.title")}
					</Title>

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
									{ required: true, message: t("auth:login.emailRequired") },
									{ type: "email", message: t("auth:login.emailInvalid") },
									{
										min: EMAIL_MIN_LENGTH,
										message: t("auth:login.emailMinLength", {
											min: EMAIL_MIN_LENGTH,
										}),
									},
									{
										max: EMAIL_MAX_LENGTH,
										message: t("auth:login.emailMaxLength", {
											max: EMAIL_MAX_LENGTH,
										}),
									},
								]}
							>
								<Input
									prefix={<UserOutlined />}
									placeholder={t("auth:login.email")}
									size="large"
								/>
							</Form.Item>

							<Form.Item
								name="password"
								validateFirst
								rules={[
									{ required: true, message: t("auth:login.passwordRequired") },
									{
										min: PASSWORD_MIN_LENGTH,
										message: t("auth:login.passwordMinLength", {
											min: PASSWORD_MIN_LENGTH,
										}),
									},
									{
										max: PASSWORD_MAX_LENGTH,
										message: t("auth:login.passwordMaxLength", {
											max: PASSWORD_MAX_LENGTH,
										}),
									},
								]}
							>
								<Input.Password
									prefix={<LockOutlined />}
									placeholder={t("auth:login.password")}
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
											form
												.getFieldsError()
												.some(({ errors }) => errors.length > 0)
										}
										block
										size="large"
									>
										{t("auth:login.submit")}
									</Button>
								)}
							</Form.Item>
						</Form>
					</Spin>

					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Text>
							<Link to="/signup">{t("signup:signupLink")}</Link>
						</Text>
					</div>
				</Card>
			</Content>
		</Layout>
	);
}
