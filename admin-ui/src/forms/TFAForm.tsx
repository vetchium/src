import { Form, Input, Button, Alert, Space, Spin } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { TFA_CODE_LENGTH } from "vetchium-specs/common/common";
import { useAuth } from "../contexts/AuthContext";

interface TFAFormValues {
	tfa_code: string;
}

export function TFAForm() {
	const { t } = useTranslation("auth");
	const { verifyTFA, backToLogin, loading, error } = useAuth();
	const [form] = Form.useForm<TFAFormValues>();

	const handleFinish = async (values: TFAFormValues) => {
		await verifyTFA(values.tfa_code);
	};

	return (
		<Spin spinning={loading}>
			<Form<TFAFormValues>
				form={form}
				name="tfa"
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
					name="tfa_code"
					validateFirst
					rules={[
						{ required: true, message: t("tfa.codeRequired") },
						{
							len: TFA_CODE_LENGTH,
							message: t("tfa.codeLength", { length: TFA_CODE_LENGTH }),
						},
						{
							pattern: /^[0-9]+$/,
							message: t("tfa.codeDigitsOnly"),
						},
					]}
				>
					<Input
						prefix={<SafetyOutlined />}
						placeholder={t("tfa.code")}
						size="large"
						maxLength={TFA_CODE_LENGTH}
					/>
				</Form.Item>

				<Form.Item shouldUpdate style={{ marginBottom: 0 }}>
					{() => (
						<Space orientation="vertical" style={{ width: "100%" }}>
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
								{t("tfa.submit")}
							</Button>
							<Button
								type="link"
								onClick={backToLogin}
								block
								disabled={loading}
							>
								{t("tfa.backToLogin")}
							</Button>
						</Space>
					)}
				</Form.Item>
			</Form>
		</Spin>
	);
}
