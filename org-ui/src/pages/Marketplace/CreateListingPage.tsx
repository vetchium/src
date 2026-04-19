import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Form,
	Input,
	Select,
	Spin,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { MarketplaceCapability } from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;
const { TextArea } = Input;

export function CreateListingPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { message } = App.useApp();
	const [form] = Form.useForm();

	const [capabilities, setCapabilities] = useState<MarketplaceCapability[]>([]);
	const [submitting, setSubmitting] = useState(false);

	const loadCapabilities = useCallback(async () => {
		if (!sessionToken) return;
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/list-capabilities`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({}),
			});
			if (resp.status === 200) {
				const data = await resp.json();
				setCapabilities(data.capabilities || []);
			}
		} catch {
			// ignore
		}
	}, [sessionToken]);

	useEffect(() => {
		loadCapabilities();
	}, [loadCapabilities]);

	const handleSubmit = async (values: {
		headline: string;
		description: string;
		capabilities: string[];
	}) => {
		if (!sessionToken) return;
		setSubmitting(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/create`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(values),
			});
			if (resp.status === 201) {
				message.success(t("create.success"));
				navigate("/marketplace/listings");
			} else if (resp.status === 400) {
				const errs = await resp.json();
				message.error(errs.map((e: { message: string }) => e.message).join(", "));
			} else if (resp.status === 403) {
				const payload = await resp.json();
				message.error(
					t("quotaExceeded", {
						tier: payload.tier_id,
						cap: payload.current_cap,
					})
				);
			} else {
				message.error(t("create.error"));
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 800,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to="/marketplace/listings">
					<Button icon={<ArrowLeftOutlined />}>{t("create.back")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("create.title")}
			</Title>

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					<Form.Item
						name="headline"
						label={t("create.headline")}
						rules={[
							{ required: true, message: t("create.headlineRequired") },
							{ max: 100, message: t("create.headlineMax") },
						]}
					>
						<Input maxLength={100} showCount />
					</Form.Item>

					<Form.Item
						name="capabilities"
						label={t("create.capabilities")}
						rules={[
							{ required: true, message: t("create.capabilitiesRequired") },
							{ type: "array", min: 1, max: 5, message: t("create.capabilitiesRange") },
						]}
					>
						<Select
							mode="multiple"
							maxCount={5}
							placeholder={t("create.capabilitiesPlaceholder")}
							options={capabilities.map((c) => ({
								value: c.capability_id,
								label: c.display_name,
							}))}
						/>
					</Form.Item>

					<Form.Item
						name="description"
						label={t("create.description")}
						rules={[
							{ required: true, message: t("create.descriptionRequired") },
							{ max: 10000, message: t("create.descriptionMax") },
						]}
					>
						<TextArea rows={8} maxLength={10000} showCount />
					</Form.Item>

					<Form.Item>
						<Button type="primary" htmlType="submit" loading={submitting}>
							{t("create.submit")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
}
