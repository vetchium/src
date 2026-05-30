import React, { useCallback, useEffect, useState } from "react";
import { Button, Card, Form, Spin, Switch, Typography, message } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	HubApplyPreferences,
	SetNotifyConnectionsOnApplyRequest,
	SetAllowUnsolicitedEndorsementsRequest,
} from "vetchium-specs/hub/apply-preferences";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

export const ApplyPreferencesPage: React.FC = () => {
	const { t } = useTranslation("preferences");
	const { sessionToken } = useAuth();
	const [prefs, setPrefs] = useState<HubApplyPreferences>({
		notify_connections_on_apply: false,
		allow_unsolicited_endorsements: false,
	});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	const fetchPrefs = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/get-apply-preferences`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({}),
			});
			if (res.status === 200) {
				setPrefs(await res.json());
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken]);

	useEffect(() => {
		fetchPrefs();
	}, [fetchPrefs]);

	const handleNotifyChange = async (checked: boolean) => {
		if (!sessionToken) return;
		setSaving(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: SetNotifyConnectionsOnApplyRequest = {
				notify_connections_on_apply: checked,
			};
			const res = await fetch(
				`${apiBaseUrl}/hub/set-notify-connections-on-apply`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (res.status === 200) {
				setPrefs((p) => ({ ...p, notify_connections_on_apply: checked }));
				message.success(t("saved"));
			}
		} finally {
			setSaving(false);
		}
	};

	const handleUnsolicitedChange = async (checked: boolean) => {
		if (!sessionToken) return;
		setSaving(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: SetAllowUnsolicitedEndorsementsRequest = {
				allow_unsolicited_endorsements: checked,
			};
			const res = await fetch(
				`${apiBaseUrl}/hub/set-allow-unsolicited-endorsements`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (res.status === 200) {
				setPrefs((p) => ({
					...p,
					allow_unsolicited_endorsements: checked,
				}));
				message.success(t("saved"));
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

			<Spin spinning={loading || saving}>
				<Card>
					<Form layout="vertical">
						<Form.Item
							label={t("notifyConnections")}
							extra={t("notifyConnectionsHelp")}
						>
							<Switch
								checked={prefs.notify_connections_on_apply}
								onChange={handleNotifyChange}
								disabled={saving}
							/>
						</Form.Item>
						<Form.Item
							label={t("allowUnsolicited")}
							extra={t("allowUnsolicitedHelp")}
						>
							<Switch
								checked={prefs.allow_unsolicited_endorsements}
								onChange={handleUnsolicitedChange}
								disabled={saving}
							/>
						</Form.Item>
					</Form>
				</Card>
			</Spin>
		</div>
	);
};
