import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Select, Spin, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	CreateProviderOfferRequest,
	MarketplaceContactMode,
	MarketplaceOffer,
	UpdateProviderOfferRequest,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;
const { TextArea } = Input;

export function MarketplaceProvideOfferEditPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();
	const { capability_slug } = useParams<{ capability_slug: string }>();

	const [existingOffer, setExistingOffer] = useState<MarketplaceOffer | null>(
		null
	);
	const [loadingOffer, setLoadingOffer] = useState(false);
	const [submitLoading, setSubmitLoading] = useState(false);
	const [form] = Form.useForm();

	const loadOffer = useCallback(async () => {
		if (!sessionToken || !capability_slug) return;
		setLoadingOffer(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/provider-offers/get`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ capability_slug }),
				}
			);
			if (resp.status === 200) {
				const data: MarketplaceOffer = await resp.json();
				setExistingOffer(data);
				form.setFieldsValue({
					headline: data.headline,
					summary: data.summary,
					description: data.description,
					regions_served: data.regions_served,
					pricing_hint: data.pricing_hint ?? "",
					contact_mode: data.contact_mode,
					contact_value: data.contact_value,
				});
			} else {
				setExistingOffer(null);
			}
		} catch {
			// no existing offer
		} finally {
			setLoadingOffer(false);
		}
	}, [sessionToken, capability_slug, form]);

	useEffect(() => {
		loadOffer();
	}, [loadOffer]);

	const handleSubmit = async (values: {
		headline: string;
		summary: string;
		description: string;
		regions_served: string[];
		pricing_hint?: string;
		contact_mode: MarketplaceContactMode;
		contact_value: string;
	}) => {
		if (!sessionToken || !capability_slug) return;
		setSubmitLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const isEdit = !!existingOffer;
			const endpoint = isEdit
				? `${baseUrl}/org/marketplace/provider-offers/update`
				: `${baseUrl}/org/marketplace/provider-offers/create`;
			const req: CreateProviderOfferRequest | UpdateProviderOfferRequest = {
				capability_slug,
				headline: values.headline,
				summary: values.summary,
				description: values.description,
				regions_served: values.regions_served,
				contact_mode: values.contact_mode,
				contact_value: values.contact_value,
				...(values.pricing_hint ? { pricing_hint: values.pricing_hint } : {}),
			};
			const resp = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200 || resp.status === 201) {
				message.success(t("provideOfferEdit.success.saved"));
				navigate(`/marketplace/provide/${capability_slug}/offer`);
			} else {
				message.error(t("provideOfferEdit.errors.saveFailed"));
			}
		} catch {
			message.error(t("provideOfferEdit.errors.saveFailed"));
		} finally {
			setSubmitLoading(false);
		}
	};

	const contactModeOptions: {
		value: MarketplaceContactMode;
		label: string;
	}[] = [
		{
			value: "platform_message",
			label: t("provideOfferEdit.contactModes.platform_message"),
		},
		{
			value: "external_url",
			label: t("provideOfferEdit.contactModes.external_url"),
		},
		{ value: "email", label: t("provideOfferEdit.contactModes.email") },
	];

	const isEdit = !!existingOffer;

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 1200,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				{isEdit ? (
					<Link to={`/marketplace/provide/${capability_slug}/offer`}>
						<Button icon={<ArrowLeftOutlined />}>
							{t("provideOfferEdit.backToOffer")}
						</Button>
					</Link>
				) : (
					<Link to={`/marketplace/provide/${capability_slug}`}>
						<Button icon={<ArrowLeftOutlined />}>
							{t("provideOfferEdit.backToCapability")}
						</Button>
					</Link>
				)}
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{isEdit
					? t("provideOfferEdit.editTitle")
					: t("provideOfferEdit.createTitle")}
			</Title>

			<Spin spinning={loadingOffer}>
				<div style={{ maxWidth: 640 }}>
					<Form
						form={form}
						layout="vertical"
						onFinish={handleSubmit}
						initialValues={{ contact_mode: "external_url" }}
					>
						<Form.Item
							name="headline"
							label={t("provideOfferEdit.headlineLabel")}
							rules={[
								{
									required: true,
									message: t("provideOfferEdit.errors.headlineRequired"),
								},
								{
									max: 200,
									message: t("provideOfferEdit.errors.headlineTooLong"),
								},
							]}
						>
							<Input
								placeholder={t("provideOfferEdit.headlinePlaceholder")}
							/>
						</Form.Item>

						<Form.Item
							name="summary"
							label={t("provideOfferEdit.summaryLabel")}
							rules={[
								{
									required: true,
									message: t("provideOfferEdit.errors.summaryRequired"),
								},
								{
									max: 500,
									message: t("provideOfferEdit.errors.summaryTooLong"),
								},
							]}
						>
							<TextArea
								rows={3}
								placeholder={t("provideOfferEdit.summaryPlaceholder")}
							/>
						</Form.Item>

						<Form.Item
							name="description"
							label={t("provideOfferEdit.descriptionLabel")}
							rules={[
								{
									required: true,
									message: t("provideOfferEdit.errors.descriptionRequired"),
								},
								{
									max: 5000,
									message: t("provideOfferEdit.errors.descriptionTooLong"),
								},
							]}
						>
							<TextArea
								rows={8}
								placeholder={t("provideOfferEdit.descriptionPlaceholder")}
							/>
						</Form.Item>

						<Form.Item
							name="regions_served"
							label={t("provideOfferEdit.regionsLabel")}
							rules={[
								{
									required: true,
									type: "array",
									min: 1,
									message: t("provideOfferEdit.errors.regionsRequired"),
								},
							]}
						>
							<Select
								mode="tags"
								placeholder={t("provideOfferEdit.regionsPlaceholder")}
							/>
						</Form.Item>

						<Form.Item
							name="pricing_hint"
							label={t("provideOfferEdit.pricingLabel")}
						>
							<Input
								placeholder={t("provideOfferEdit.pricingPlaceholder")}
							/>
						</Form.Item>

						<Form.Item
							name="contact_mode"
							label={t("provideOfferEdit.contactModeLabel")}
							rules={[{ required: true }]}
						>
							<Select options={contactModeOptions} />
						</Form.Item>

						<Form.Item
							name="contact_value"
							label={t("provideOfferEdit.contactValueLabel")}
							rules={[
								{
									required: true,
									message: t("provideOfferEdit.errors.contactValueRequired"),
								},
							]}
						>
							<Input
								placeholder={t("provideOfferEdit.contactValuePlaceholder")}
							/>
						</Form.Item>

						<Form.Item shouldUpdate>
							{() => (
								<Button
									type="primary"
									htmlType="submit"
									loading={submitLoading}
									disabled={form
										.getFieldsError()
										.some(({ errors }) => errors.length > 0)}
								>
									{t("provideOfferEdit.submitButton")}
								</Button>
							)}
						</Form.Item>
					</Form>
				</div>
			</Spin>
		</div>
	);
}
