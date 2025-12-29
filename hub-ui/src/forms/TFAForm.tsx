import { Form, Input, Button, Alert, Space, Checkbox } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { TFA_CODE_LENGTH } from "vetchium-specs/common/common";
import { useAuth } from "../contexts/AuthContext";

interface TFAFormValues {
	tfa_code: string;
	remember_me: boolean;
}

export function TFAForm() {
	const { t } = useTranslation("auth");
	const { verifyTFA, backToLogin, loading, error } = useAuth();
	const [form] = Form.useForm();

	const handleFinish = async (values: TFAFormValues) => {
		await verifyTFA(values.tfa_code, values.remember_me);
	};

	return (
		<Form<TFAFormValues>
			form={form}
			name="tfa"
			onFinish={handleFinish}
			layout="vertical"
			requiredMark={false}
			initialValues={{ remember_me: false }}
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

			<Form.Item name="remember_me" valuePropName="checked">
				<Checkbox>{t("tfa.rememberMe")}</Checkbox>
			</Form.Item>

			<Form.Item>
				<Space direction="vertical" style={{ width: "100%" }}>
					<Button
						type="primary"
						htmlType="submit"
						loading={loading}
						block
						size="large"
					>
						{t("tfa.submit")}
					</Button>
					<Button type="link" onClick={backToLogin} block disabled={loading}>
						{t("tfa.backToLogin")}
					</Button>
				</Space>
			</Form.Item>
		</Form>
	);
}
