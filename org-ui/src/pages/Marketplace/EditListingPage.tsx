import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Spin, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { MarketplaceListing } from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;
const { TextArea } = Input;

export function EditListingPage() {
	const { t } = useTranslation("marketplace");
	const { orgDomain, listingNumber } = useParams<{
		orgDomain: string;
		listingNumber: string;
	}>();
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { message } = App.useApp();
	const [form] = Form.useForm();

	const [listing, setListing] = useState<MarketplaceListing | null>(null);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);

	const loadListing = useCallback(async () => {
		if (!sessionToken || !orgDomain || !listingNumber) return;
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/get`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					org_domain: orgDomain,
					listing_number: parseInt(listingNumber, 10),
				}),
			});
			if (resp.status === 200) {
				const data: MarketplaceListing = await resp.json();
				setListing(data);
				form.setFieldsValue({
					headline: data.headline,
					description: data.description,
				});
			} else {
				navigate(`/marketplace/listings/${orgDomain}/${listingNumber}`);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, orgDomain, listingNumber, form, navigate]);

	useEffect(() => {
		loadListing();
	}, [loadListing]);

	const handleSubmit = async (values: {
		headline: string;
		description: string;
	}) => {
		if (!sessionToken || !listing) return;
		setSubmitting(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/listing/update`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					listing_number: listing.listing_number,
					headline: values.headline,
					description: values.description,
				}),
			});
			if (resp.status === 200) {
				message.success(t("edit.success"));
				navigate(
					`/marketplace/listings/${listing.org_domain}/${listing.listing_number}`
				);
			} else if (resp.status === 400) {
				const errs = await resp.json();
				message.error(
					errs.map((e: { message: string }) => e.message).join(", ")
				);
			} else {
				message.error(t("edit.error"));
			}
		} finally {
			setSubmitting(false);
		}
	};

	if (loading) {
		return (
			<div style={{ textAlign: "center", padding: 64 }}>
				<Spin size="large" />
			</div>
		);
	}

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
				<Link to={`/marketplace/listings/${orgDomain}/${listingNumber}`}>
					<Button icon={<ArrowLeftOutlined />}>{t("edit.back")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("edit.title")}
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
							{t("edit.submit")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
}
