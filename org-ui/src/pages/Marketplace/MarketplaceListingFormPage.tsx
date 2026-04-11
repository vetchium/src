import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import { Alert, Button, Form, Input, Select, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { getApiBaseUrl } from "../../config";
import type {
	CreateListingRequest,
	GetMyListingRequest,
	MarketplaceListing,
	UpdateListingRequest,
	ListMarketplaceCapabilitiesRequest,
	ListMarketplaceCapabilitiesResponse,
	MarketplaceCapability,
} from "vetchium-specs/org/marketplace";

const { Title } = Typography;

export function MarketplaceListingFormPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { listing_id } = useParams<{ listing_id?: string }>();
	const isEdit = !!listing_id;

	const [form] = Form.useForm();
	const [loading, setLoading] = useState(isEdit);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [capabilities, setCapabilities] = useState<MarketplaceCapability[]>([]);

	// Load capabilities for the capability_id dropdown
	useEffect(() => {
		if (!sessionToken) return;
		(async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const reqBody: ListMarketplaceCapabilitiesRequest = { limit: 200 };
				const resp = await fetch(
					`${apiBaseUrl}/org/marketplace/capabilities/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(reqBody),
					}
				);
				if (resp.status === 200) {
					const data: ListMarketplaceCapabilitiesResponse = await resp.json();
					setCapabilities(data.capabilities);
				}
			} catch {
				// non-fatal; capabilities just won't be in dropdown
			}
		})();
	}, [sessionToken]);

	// Load existing listing for edit mode
	const fetchListing = useCallback(async () => {
		if (!sessionToken || !listing_id) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: GetMyListingRequest = { listing_id };
			const resp = await fetch(`${apiBaseUrl}/org/marketplace/listings/get`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(reqBody),
			});
			if (resp.status === 200) {
				const data: MarketplaceListing = await resp.json();
				form.setFieldsValue({
					capability_id: data.capability_id,
					headline: data.headline,
					summary: data.summary,
					description: data.description,
					regions_served: data.regions_served,
					pricing_hint: data.pricing_hint,
					contact_mode: data.contact_mode,
					contact_value: data.contact_value,
				});
			} else {
				setError(t("listingForm.errors.loadFailed"));
			}
		} catch {
			setError(t("listingForm.errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, listing_id, form, t]);

	useEffect(() => {
		if (isEdit) {
			fetchListing();
		}
	}, [isEdit, fetchListing]);

	const handleSubmit = async (values: {
		capability_id: string;
		headline: string;
		summary: string;
		description: string;
		regions_served: string[];
		pricing_hint?: string;
		contact_mode: string;
		contact_value: string;
	}) => {
		if (!sessionToken) return;
		setSubmitting(true);
		setError(null);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			let resp: Response;
			if (isEdit && listing_id) {
				const reqBody: UpdateListingRequest = {
					listing_id,
					headline: values.headline,
					summary: values.summary,
					description: values.description,
					regions_served: values.regions_served,
					pricing_hint: values.pricing_hint,
					contact_mode: values.contact_mode as never,
					contact_value: values.contact_value,
				};
				resp = await fetch(`${apiBaseUrl}/org/marketplace/listings/update`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(reqBody),
				});
			} else {
				const reqBody: CreateListingRequest = {
					capability_id: values.capability_id,
					headline: values.headline,
					summary: values.summary,
					description: values.description,
					regions_served: values.regions_served,
					pricing_hint: values.pricing_hint,
					contact_mode: values.contact_mode as never,
					contact_value: values.contact_value,
				};
				resp = await fetch(`${apiBaseUrl}/org/marketplace/listings/create`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(reqBody),
				});
			}
			if (resp.status === 200 || resp.status === 201) {
				navigate("/marketplace/listings");
			} else if (resp.status === 422) {
				setError(t("listingForm.errors.noOrgDomain"));
			} else {
				setError(t("listingForm.errors.saveFailed"));
			}
		} catch {
			setError(t("listingForm.errors.saveFailed"));
		} finally {
			setSubmitting(false);
		}
	};

	if (loading) return <Spin size="large" style={{ padding: 48 }} />;

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
					<Button icon={<ArrowLeftOutlined />}>
						{t("listingForm.backToListings")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{isEdit ? t("listingForm.editTitle") : t("listingForm.createTitle")}
			</Title>

			{error && (
				<Alert type="error" title={error} style={{ marginBottom: 16 }} />
			)}

			<Spin spinning={submitting}>
				<Form
					form={form}
					layout="vertical"
					onFinish={handleSubmit}
					initialValues={{ contact_mode: "external_url" }}
				>
					{!isEdit && (
						<Form.Item
							name="capability_id"
							label={t("listingForm.capabilityLabel")}
							rules={[
								{
									required: true,
									message: t("listingForm.errors.capabilityRequired"),
								},
							]}
						>
							<Select
								showSearch
								placeholder={t("listingForm.capabilityPlaceholder")}
								options={capabilities.map((c) => ({
									value: c.capability_id,
									label: `${c.capability_id} — ${c.display_name}`,
								}))}
							/>
						</Form.Item>
					)}

					<Form.Item
						name="headline"
						label={t("listingForm.headlineLabel")}
						rules={[
							{
								required: true,
								message: t("listingForm.errors.headlineRequired"),
							},
							{ max: 100, message: t("listingForm.errors.headlineTooLong") },
						]}
					>
						<Input placeholder={t("listingForm.headlinePlaceholder")} />
					</Form.Item>

					<Form.Item
						name="summary"
						label={t("listingForm.summaryLabel")}
						rules={[
							{
								required: true,
								message: t("listingForm.errors.summaryRequired"),
							},
							{ max: 500, message: t("listingForm.errors.summaryTooLong") },
						]}
					>
						<Input.TextArea
							rows={3}
							placeholder={t("listingForm.summaryPlaceholder")}
						/>
					</Form.Item>

					<Form.Item
						name="description"
						label={t("listingForm.descriptionLabel")}
						rules={[
							{
								required: true,
								message: t("listingForm.errors.descriptionRequired"),
							},
							{
								max: 10000,
								message: t("listingForm.errors.descriptionTooLong"),
							},
						]}
					>
						<Input.TextArea
							rows={8}
							placeholder={t("listingForm.descriptionPlaceholder")}
						/>
					</Form.Item>

					<Form.Item
						name="regions_served"
						label={t("listingForm.regionsLabel")}
						rules={[
							{
								required: true,
								message: t("listingForm.errors.regionsRequired"),
							},
						]}
					>
						<Select
							mode="tags"
							placeholder={t("listingForm.regionsPlaceholder")}
						/>
					</Form.Item>

					<Form.Item name="pricing_hint" label={t("listingForm.pricingLabel")}>
						<Input placeholder={t("listingForm.pricingPlaceholder")} />
					</Form.Item>

					<Form.Item
						name="contact_mode"
						label={t("listingForm.contactModeLabel")}
					>
						<Select
							options={[
								{
									value: "external_url",
									label: t("listingForm.contactModes.external_url"),
								},
								{
									value: "email",
									label: t("listingForm.contactModes.email"),
								},
								{
									value: "platform_message",
									label: t("listingForm.contactModes.platform_message"),
								},
							]}
						/>
					</Form.Item>

					<Form.Item
						name="contact_value"
						label={t("listingForm.contactValueLabel")}
						rules={[
							{
								required: true,
								message: t("listingForm.errors.contactValueRequired"),
							},
						]}
					>
						<Input placeholder={t("listingForm.contactValuePlaceholder")} />
					</Form.Item>

					<Form.Item
						shouldUpdate={(prev, curr) =>
							prev.headline !== curr.headline ||
							prev.summary !== curr.summary ||
							prev.description !== curr.description ||
							prev.contact_value !== curr.contact_value
						}
					>
						{() => {
							const hasErrors = form
								.getFieldsError()
								.some(({ errors }) => errors.length > 0);
							return (
								<Button
									type="primary"
									htmlType="submit"
									disabled={hasErrors}
									loading={submitting}
								>
									{t("listingForm.submitButton")}
								</Button>
							);
						}}
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
}
