import {
	ArrowLeftOutlined,
} from "@ant-design/icons";
import {
	App,
	Button,
	Card,
	Col,
	Form,
	Input,
	Row,
	Spin,
	Typography,
	Select,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	CreateMarketplaceServiceListingRequest,
	ServiceListing,
	UpdateMarketplaceServiceListingRequest,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text } = Typography;
const { TextArea } = Input;

type ListingFormValues = {
	name: string;
	short_blurb: string;
	description: string;
	countries_of_service: string;
	contact_url: string;
	pricing_info?: string;
	industries_served: string[];
	industries_served_other?: string;
	company_sizes_served: string[];
	job_functions_sourced: string[];
	seniority_levels_sourced: string[];
	geographic_sourcing_regions: string;
};

function formValuesToCreateRequest(
	values: ListingFormValues
): CreateMarketplaceServiceListingRequest {
	return {
		name: values.name,
		short_blurb: values.short_blurb,
		description: values.description,
		service_category: "talent_sourcing",
		countries_of_service: values.countries_of_service
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		contact_url: values.contact_url,
		pricing_info: values.pricing_info || undefined,
		industries_served: values.industries_served as never[],
		industries_served_other: values.industries_served_other || undefined,
		company_sizes_served: values.company_sizes_served as never[],
		job_functions_sourced: values.job_functions_sourced as never[],
		seniority_levels_sourced: values.seniority_levels_sourced as never[],
		geographic_sourcing_regions: values.geographic_sourcing_regions
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	};
}

function listingToFormValues(listing: ServiceListing): ListingFormValues {
	return {
		name: listing.name,
		short_blurb: listing.short_blurb,
		description: listing.description,
		countries_of_service: listing.countries_of_service.join(", "),
		contact_url: listing.contact_url,
		pricing_info: listing.pricing_info ?? "",
		industries_served: listing.industries_served,
		industries_served_other: listing.industries_served_other ?? "",
		company_sizes_served: listing.company_sizes_served,
		job_functions_sourced: listing.job_functions_sourced,
		seniority_levels_sourced: listing.seniority_levels_sourced,
		geographic_sourcing_regions: listing.geographic_sourcing_regions.join(", "),
	};
}

export function MarketplaceListingFormPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();
	// name is present when route is /marketplace/service-listings/:name/edit
	const { name: listingName } = useParams<{ name?: string }>();
	const isEdit = !!listingName;

	const [form] = Form.useForm<ListingFormValues>();
	const [saving, setSaving] = useState(false);
	const [submittingForReview, setSubmittingForReview] = useState(false);
	const [loadingListing, setLoadingListing] = useState(isEdit);
	const [loadError, setLoadError] = useState(false);

	// In edit mode, fetch the listing from the API by name
	useEffect(() => {
		if (!isEdit || !listingName || !sessionToken) return;

		setLoadingListing(true);
		setLoadError(false);
		getApiBaseUrl()
			.then((baseUrl) =>
				fetch(`${baseUrl}/org/get-marketplace-service-listing`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ name: decodeURIComponent(listingName) }),
				})
			)
			.then(async (resp) => {
				if (resp.status === 200) {
					const listing: ServiceListing = await resp.json();
					form.setFieldsValue(listingToFormValues(listing));
				} else {
					setLoadError(true);
				}
			})
			.catch(() => setLoadError(true))
			.finally(() => setLoadingListing(false));
	}, [isEdit, listingName, sessionToken, form]);

	const industryOptions = [
		"technology_software",
		"finance_banking",
		"healthcare_life_sciences",
		"manufacturing_engineering",
		"retail_consumer_goods",
		"media_entertainment",
		"education_training",
		"legal_services",
		"consulting_professional_services",
		"real_estate_construction",
		"energy_utilities",
		"logistics_supply_chain",
		"government_public_sector",
		"nonprofit_ngo",
		"other",
	].map((v) => ({ value: v, label: t(`listings.industries.${v}`) }));

	const companySizeOptions = ["startup", "smb", "enterprise"].map((v) => ({
		value: v,
		label: t(`listings.companySizes.${v}`),
	}));

	const jobFunctionOptions = [
		"engineering_technology",
		"sales_business_development",
		"marketing",
		"finance_accounting",
		"human_resources",
		"operations_supply_chain",
		"product_management",
		"design_creative",
		"legal_compliance",
		"customer_success_support",
		"data_analytics",
		"executive_general_management",
	].map((v) => ({ value: v, label: t(`listings.jobFunctions.${v}`) }));

	const seniorityOptions = [
		"intern",
		"junior",
		"mid",
		"senior",
		"lead",
		"director",
		"c_suite",
	].map((v) => ({ value: v, label: t(`listings.seniorityLevels.${v}`) }));

	const handleSave = useCallback(
		async (submitAfterSave: boolean) => {
			let values: ListingFormValues;
			try {
				values = await form.validateFields();
			} catch {
				return;
			}

			if (submitAfterSave) {
				setSubmittingForReview(true);
			} else {
				setSaving(true);
			}

			try {
				const baseUrl = await getApiBaseUrl();

				if (isEdit && listingName) {
					const req: UpdateMarketplaceServiceListingRequest = {
						...formValuesToCreateRequest(values),
						name: decodeURIComponent(listingName),
					};
					const resp = await fetch(
						`${baseUrl}/org/update-marketplace-service-listing`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${sessionToken}`,
							},
							body: JSON.stringify(req),
						}
					);
					if (resp.status === 200) {
						message.success(t("listings.success.updated"));
						navigate("/marketplace/service-listings");
					} else if (resp.status === 400) {
						const errs = await resp.json().catch(() => []);
						if (Array.isArray(errs) && errs.length > 0) {
							message.error(errs[0].message ?? t("listings.errors.createFailed"));
						} else {
							message.error(t("listings.errors.createFailed"));
						}
					} else {
						message.error(t("listings.errors.createFailed"));
					}
				} else {
					const req: CreateMarketplaceServiceListingRequest =
						formValuesToCreateRequest(values);
					const createResp = await fetch(
						`${baseUrl}/org/create-marketplace-service-listing`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${sessionToken}`,
							},
							body: JSON.stringify(req),
						}
					);
					if (createResp.status === 201) {
						if (submitAfterSave) {
							const submitResp = await fetch(
								`${baseUrl}/org/submit-marketplace-service-listing`,
								{
									method: "POST",
									headers: {
										"Content-Type": "application/json",
										Authorization: `Bearer ${sessionToken}`,
									},
									body: JSON.stringify({ name: values.name }),
								}
							);
							if (submitResp.status === 200) {
								message.success(t("listings.success.submitted"));
							} else {
								message.success(t("listings.success.created"));
								message.warning(t("listings.errors.submitFailed"));
							}
						} else {
							message.success(t("listings.success.created"));
						}
						navigate("/marketplace/service-listings");
					} else if (createResp.status === 400) {
						const errs = await createResp.json().catch(() => []);
						if (Array.isArray(errs) && errs.length > 0) {
							message.error(errs[0].message ?? t("listings.errors.createFailed"));
						} else {
							message.error(t("listings.errors.createFailed"));
						}
					} else if (createResp.status === 409) {
						message.error(t("listings.errors.nameTaken"));
					} else {
						message.error(t("listings.errors.createFailed"));
					}
				}
			} catch {
				message.error(t("listings.errors.createFailed"));
			} finally {
				setSaving(false);
				setSubmittingForReview(false);
			}
		},
		[form, isEdit, listingName, sessionToken, message, t, navigate]
	);

	const pageTitle = isEdit ? t("listings.editTitle") : t("listings.createTitle");

	if (loadError) {
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
					<Link to="/marketplace/service-listings">
						<Button icon={<ArrowLeftOutlined />}>
							{t("listings.backToListings")}
						</Button>
					</Link>
				</div>
				<Text type="danger">{t("listings.errors.loadFailed")}</Text>
			</div>
		);
	}

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
				<Link to="/marketplace/service-listings">
					<Button icon={<ArrowLeftOutlined />}>
						{t("listings.backToListings")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{pageTitle}
			</Title>

			<Spin spinning={loadingListing || saving || submittingForReview}>
				<Form form={form} layout="vertical">
					<Row gutter={[24, 0]}>
						<Col xs={24} lg={12}>
							<Card
								title={t("listings.formSections.basicInfo")}
								style={{ marginBottom: 24 }}
							>
								<Form.Item
									name="name"
									label={t("listings.name")}
									rules={[
										{
											required: true,
											message: t("listings.errors.nameRequired"),
										},
										{ max: 100, message: t("listings.errors.nameTooLong") },
									]}
								>
									<Input
										placeholder={t("listings.namePlaceholder")}
										disabled={isEdit}
									/>
								</Form.Item>

								<Form.Item
									name="short_blurb"
									label={t("listings.shortBlurb")}
									rules={[
										{
											required: true,
											message: t("listings.errors.shortBlurbRequired"),
										},
										{
											max: 250,
											message: t("listings.errors.shortBlurbTooLong"),
										},
									]}
								>
									<Input placeholder={t("listings.shortBlurbPlaceholder")} />
								</Form.Item>

								<Form.Item
									name="description"
									label={t("listings.description")}
									rules={[
										{
											required: true,
											message: t("listings.errors.descriptionRequired"),
										},
										{
											max: 5000,
											message: t("listings.errors.descriptionTooLong"),
										},
									]}
								>
									<TextArea
										rows={5}
										placeholder={t("listings.descriptionPlaceholder")}
									/>
								</Form.Item>

								<Form.Item
									name="contact_url"
									label={t("listings.contactUrl")}
									rules={[
										{
											required: true,
											message: t("listings.errors.contactUrlRequired"),
										},
										{
											pattern: /^https:\/\/.+/,
											message: t("listings.errors.contactUrlInvalid"),
										},
									]}
								>
									<Input placeholder={t("listings.contactUrlPlaceholder")} />
								</Form.Item>

								<Form.Item
									name="countries_of_service"
									label={t("listings.countriesOfService")}
									rules={[
										{
											required: true,
											message: t("listings.errors.countriesRequired"),
										},
									]}
								>
									<Input
										placeholder={t("listings.countriesOfServicePlaceholder")}
									/>
								</Form.Item>

								<Form.Item
									name="pricing_info"
									label={t("listings.pricingInfo")}
									rules={[
										{
											max: 500,
											message: t("listings.errors.pricingInfoTooLong"),
										},
									]}
								>
									<TextArea
										rows={2}
										placeholder={t("listings.pricingInfoPlaceholder")}
									/>
								</Form.Item>
							</Card>
						</Col>

						<Col xs={24} lg={12}>
							<Card
								title={t("listings.formSections.talentSourcing")}
								style={{ marginBottom: 24 }}
							>
								<Form.Item
									name="industries_served"
									label={t("listings.industriesServed")}
									rules={[
										{
											required: true,
											type: "array",
											min: 1,
											message: t("listings.errors.industriesRequired"),
										},
									]}
								>
									<Select
										mode="multiple"
										options={industryOptions}
										placeholder={t("listings.industriesServed")}
									/>
								</Form.Item>

								<Form.Item noStyle shouldUpdate>
									{() => {
										const industries = form.getFieldValue(
											"industries_served"
										) as string[];
										const hasOther = industries?.includes("other");
										return (
											hasOther && (
												<Form.Item
													name="industries_served_other"
													label={t("listings.industriesServedOther")}
													rules={[
														{
															required: true,
															message: t(
																"listings.errors.industriesOtherRequired"
															),
														},
														{
															max: 100,
															message: t(
																"listings.errors.industriesOtherTooLong"
															),
														},
													]}
												>
													<Input
														placeholder={t(
															"listings.industriesServedOtherPlaceholder"
														)}
													/>
												</Form.Item>
											)
										);
									}}
								</Form.Item>

								<Form.Item
									name="company_sizes_served"
									label={t("listings.companySizesServed")}
									rules={[
										{
											required: true,
											type: "array",
											min: 1,
											message: t("listings.errors.companySizesRequired"),
										},
									]}
								>
									<Select
										mode="multiple"
										options={companySizeOptions}
										placeholder={t("listings.companySizesServed")}
									/>
								</Form.Item>

								<Form.Item
									name="job_functions_sourced"
									label={t("listings.jobFunctionsSourced")}
									rules={[
										{
											required: true,
											type: "array",
											min: 1,
											message: t("listings.errors.jobFunctionsRequired"),
										},
									]}
								>
									<Select
										mode="multiple"
										options={jobFunctionOptions}
										placeholder={t("listings.jobFunctionsSourced")}
									/>
								</Form.Item>

								<Form.Item
									name="seniority_levels_sourced"
									label={t("listings.seniorityLevelsSourced")}
									rules={[
										{
											required: true,
											type: "array",
											min: 1,
											message: t("listings.errors.seniorityLevelsRequired"),
										},
									]}
								>
									<Select
										mode="multiple"
										options={seniorityOptions}
										placeholder={t("listings.seniorityLevelsSourced")}
									/>
								</Form.Item>

								<Form.Item
									name="geographic_sourcing_regions"
									label={t("listings.geographicSourcingRegions")}
									rules={[
										{
											required: true,
											message: t("listings.errors.geographicRegionsRequired"),
										},
									]}
								>
									<Input
										placeholder={t(
											"listings.geographicSourcingRegionsPlaceholder"
										)}
									/>
								</Form.Item>
							</Card>
						</Col>
					</Row>

					<div
						style={{
							display: "flex",
							gap: 12,
							justifyContent: "flex-end",
							marginTop: 8,
						}}
					>
						<Link to="/marketplace/service-listings">
							<Button>{t("common:cancel", "Cancel")}</Button>
						</Link>
						{isEdit ? (
							<Button
								type="primary"
								loading={saving}
								onClick={() => handleSave(false)}
							>
								{t("listings.saveChanges")}
							</Button>
						) : (
							<>
								<Button loading={saving} onClick={() => handleSave(false)}>
									{t("listings.saveAsDraft")}
								</Button>
								<Button
									type="primary"
									loading={submittingForReview}
									onClick={() => handleSave(true)}
								>
									{t("listings.submitForReview")}
								</Button>
							</>
						)}
					</div>
				</Form>
			</Spin>
		</div>
	);
}
