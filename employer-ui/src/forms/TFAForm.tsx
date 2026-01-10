import { Form, Input, Button, Alert, Spin } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { TFA_CODE_LENGTH } from "vetchium-specs/common/common";

interface TFAFormValues {
	tfaCode: string;
}

export function TFAForm() {
	const { t } = useTranslation("auth");
	const { verifyTFA, loading, error, backToLogin, clearError } = useAuth();
	const [form] = Form.useForm<TFAFormValues>();

	const handleSubmit = async (values: TFAFormValues) => {
		await verifyTFA(values.tfaCode);
	};

	return (
		<Spin spinning={loading}>
			<Form
				form={form}
				name="tfa"
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
					name="tfaCode"
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
						autoComplete="one-time-code"
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
							{t("tfa.submit")}
						</Button>
					)}
				</Form.Item>

				<Form.Item>
					<Button type="link" onClick={backToLogin} block>
						{t("tfa.backToLogin")}
					</Button>
				</Form.Item>
			</Form>
		</Spin>
	);
}
