import React, { useCallback, useEffect, useState } from "react";
import {
	Button,
	Card,
	Form,
	InputNumber,
	Spin,
	Switch,
	Typography,
	message,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	OrgHiringSettings,
	UpdateOrgHiringSettingsRequest,
} from "vetchium-specs/org/hiring-settings";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

export const HiringSettingsPage: React.FC = () => {
	const { t } = useTranslation("hiringSettings");
	const { sessionToken } = useAuth();
	const [settings, setSettings] = useState<OrgHiringSettings | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [form] = Form.useForm();

	const fetchSettings = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/org/get-hiring-settings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({}),
			});
			if (res.status === 200) {
				const data: OrgHiringSettings = await res.json();
				setSettings(data);
				form.setFieldsValue({
					cool_off_days: data.cool_off_days,
					allow_unsolicited_endorsements_default:
						data.allow_unsolicited_endorsements_default,
				});
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, form]);

	useEffect(() => {
		fetchSettings();
	}, [fetchSettings]);

	const handleSave = async (values: UpdateOrgHiringSettingsRequest) => {
		if (!sessionToken) return;
		setSaving(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: UpdateOrgHiringSettingsRequest = {
				cool_off_days: values.cool_off_days,
				allow_unsolicited_endorsements_default:
					values.allow_unsolicited_endorsements_default,
			};
			const res = await fetch(`${apiBaseUrl}/org/update-hiring-settings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				message.success(t("saved"));
				fetchSettings();
			} else if (res.status === 400) {
				const errs = await res.json();
				if (Array.isArray(errs)) {
					errs.forEach((e: { message: string }) => message.error(e.message));
				}
			}
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 600,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("title")}
			</Title>

			<Spin spinning={loading}>
				{settings !== null && (
					<Card>
						<Form form={form} layout="vertical" onFinish={handleSave}>
							<Form.Item
								name="cool_off_days"
								label={t("coolOffDays")}
								extra={t("coolOffHelp")}
								rules={[
									{
										required: true,
										type: "number",
										min: 0,
										max: 365,
									},
								]}
							>
								<InputNumber min={0} max={365} style={{ width: 120 }} />
							</Form.Item>

							<Form.Item
								name="allow_unsolicited_endorsements_default"
								label="Allow unsolicited endorsements by default"
								valuePropName="checked"
							>
								<Switch />
							</Form.Item>

							<Form.Item>
								<Button type="primary" htmlType="submit" loading={saving}>
									{t("save")}
								</Button>
							</Form.Item>
						</Form>
					</Card>
				)}
			</Spin>
		</div>
	);
};
