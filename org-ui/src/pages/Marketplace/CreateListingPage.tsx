import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	Alert,
	App,
	Button,
	Form,
	Input,
	Select,
	Space,
	Spin,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { MarketplaceCapability } from "vetchium-specs/org/marketplace";
import type { OrgPlan } from "vetchium-specs/org/tiers";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;
const { TextArea } = Input;

export function CreateListingPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { message } = App.useApp();
	const [form] = Form.useForm();

	const { data: myInfo } = useMyInfo(sessionToken);
	const isSuperAdmin = myInfo?.roles.includes("org:superadmin") ?? false;

	const [capabilities, setCapabilities] = useState<MarketplaceCapability[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [subscription, setSubscription] = useState<OrgPlan | null>(null);

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

	useEffect(() => {
		if (!sessionToken) return;
		(async () => {
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(`${baseUrl}/org/get-plan`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({}),
				});
				if (resp.status === 200) setSubscription(await resp.json());
			} catch {
				// ignore — quota banner is best-effort
			}
		})();
	}, [sessionToken]);

	const listingsCap = subscription?.current_plan.marketplace_listings_cap;
	const atQuota =
		listingsCap !== undefined &&
		(listingsCap === 0 ||
			(subscription?.usage.marketplace_listings ?? 0) >= listingsCap);

	const handleSubmit = async (publish: boolean) => {
		if (!sessionToken) return;
		try {
			const values = await form.validateFields();
			setSubmitting(true);
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/create-listing`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(values),
			});
			if (resp.status === 201) {
				const created = await resp.json();
				if (publish) {
					const pubResp = await fetch(
						`${baseUrl}/org/marketplace/publish-listing`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${sessionToken}`,
							},
							body: JSON.stringify({ listing_number: created.listing_number }),
						}
					);
					if (pubResp.status === 200) {
						message.success(
							isSuperAdmin
								? t("listing.publishDirectSuccess")
								: t("listing.publishSuccess")
						);
						navigate("/marketplace/listings");
					} else if (pubResp.status === 403) {
						const payload = await pubResp.json().catch(() => null);
						if (payload?.quota) {
							message.error(
								t("quotaExceeded", {
									tier: payload.plan_id,
									cap: payload.current_cap,
								})
							);
						} else {
							message.error(t("listing.publishError"));
						}
						navigate("/marketplace/listings");
					} else {
						message.error(t("listing.publishError"));
						navigate("/marketplace/listings");
					}
				} else {
					message.success(t("create.success"));
					navigate("/marketplace/listings");
				}
			} else if (resp.status === 400) {
				const errs = await resp.json();
				message.error(
					errs.map((e: { message: string }) => e.message).join(", ")
				);
			} else {
				message.error(t("create.error"));
			}
		} catch {
			// form validation failed or fetch error
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
				<Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
					{t("create.back")}
				</Button>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("create.title")}
			</Title>

			{atQuota && (
				<Alert
					type="warning"
					showIcon
					style={{ marginBottom: 24 }}
					description={t("create.quotaBanner", {
						tier: subscription?.current_plan.plan_id ?? "",
						cap: listingsCap,
					})}
					action={
						<Link to="/settings/plan">
							<Button size="small" type="primary">
								{t("create.upgradePlan")}
							</Button>
						</Link>
					}
				/>
			)}

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical">
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
							{
								type: "array",
								min: 1,
								max: 5,
								message: t("create.capabilitiesRange"),
							},
						]}
					>
						<Select
							mode="multiple"
							showSearch
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
						<Space>
							<Button onClick={() => handleSubmit(false)} loading={submitting}>
								{t("listings.saveDraft", "Save Draft")}
							</Button>
							<Button
								type="primary"
								onClick={() => handleSubmit(true)}
								loading={submitting}
							>
								{isSuperAdmin
									? t("listing.publishDirect")
									: t("listing.publish")}
							</Button>
						</Space>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
}
