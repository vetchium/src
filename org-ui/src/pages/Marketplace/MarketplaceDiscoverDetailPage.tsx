import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import {
	Alert,
	Button,
	Card,
	Descriptions,
	Input,
	Modal,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { getApiBaseUrl } from "../../config";
import type {
	GetListingRequest,
	MarketplaceListingCard,
	RequestSubscriptionRequest,
} from "vetchium-specs/org/marketplace";

const { Title, Text } = Typography;

export function MarketplaceDiscoverDetailPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { listing_id } = useParams<{ listing_id: string }>();

	const [listing, setListing] = useState<MarketplaceListingCard | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [subscribeModalOpen, setSubscribeModalOpen] = useState(false);
	const [requestNote, setRequestNote] = useState("");
	const [subscribing, setSubscribing] = useState(false);
	const [subscribeError, setSubscribeError] = useState<string | null>(null);
	const [subscribed, setSubscribed] = useState(false);

	const fetchListing = useCallback(async () => {
		if (!sessionToken || !listing_id) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: GetListingRequest = { listing_id };
			const resp = await fetch(
				`${apiBaseUrl}/org/marketplace/discover/get`,
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
				const data: MarketplaceListingCard = await resp.json();
				setListing(data);
			} else if (resp.status === 404) {
				setError(t("discoverDetail.errors.notFound"));
			} else {
				setError(t("discoverDetail.errors.loadFailed"));
			}
		} catch {
			setError(t("discoverDetail.errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, listing_id, t]);

	useEffect(() => {
		fetchListing();
	}, [fetchListing]);

	const handleSubscribe = async () => {
		if (!sessionToken || !listing_id) return;
		setSubscribing(true);
		setSubscribeError(null);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: RequestSubscriptionRequest = {
				listing_id,
				...(requestNote && { request_note: requestNote }),
			};
			const resp = await fetch(
				`${apiBaseUrl}/org/marketplace/subscriptions/subscribe`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(reqBody),
				}
			);
			if (resp.status === 201) {
				setSubscribed(true);
				setSubscribeModalOpen(false);
			} else if (resp.status === 403) {
				setSubscribeError(t("discoverDetail.errors.subscribeForbidden"));
			} else {
				setSubscribeError(t("discoverDetail.errors.subscribeFailed"));
			}
		} catch {
			setSubscribeError(t("discoverDetail.errors.subscribeFailed"));
		} finally {
			setSubscribing(false);
		}
	};

	if (loading) return <Spin size="large" style={{ padding: 48 }} />;

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
				<Link to="/marketplace/discover">
					<Button icon={<ArrowLeftOutlined />}>
						{t("discoverDetail.backToDiscover")}
					</Button>
				</Link>
			</div>

			{error ? (
				<Alert type="error" title={error} />
			) : listing ? (
				<>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "flex-start",
							marginBottom: 24,
						}}
					>
						<Title level={2} style={{ margin: 0 }}>
							{listing.headline}
						</Title>
						{subscribed ? (
							<Tag color="green">{t("discoverDetail.subscribed")}</Tag>
						) : (
							<Button
								type="primary"
								onClick={() => setSubscribeModalOpen(true)}
							>
								{t("discoverDetail.subscribeButton")}
							</Button>
						)}
					</div>

					{subscribeError && (
						<Alert
							type="error"
							title={subscribeError}
							style={{ marginBottom: 16 }}
						/>
					)}

					<Card>
						<Descriptions column={1} bordered>
							<Descriptions.Item label={t("discoverDetail.provider")}>
								{listing.org_domain}
							</Descriptions.Item>
							<Descriptions.Item label={t("discoverDetail.capability")}>
								<Tag color="blue">{listing.capability_id}</Tag>
							</Descriptions.Item>
							<Descriptions.Item label={t("discoverDetail.summary")}>
								{listing.summary}
							</Descriptions.Item>
							<Descriptions.Item label={t("discoverDetail.regions")}>
								<Space wrap>
									{listing.regions_served.map((r) => (
										<Tag key={r}>{r}</Tag>
									))}
								</Space>
							</Descriptions.Item>
							{listing.pricing_hint && (
								<Descriptions.Item label={t("discoverDetail.pricing")}>
									{listing.pricing_hint}
								</Descriptions.Item>
							)}
							<Descriptions.Item label={t("discoverDetail.contact")}>
								{listing.contact_mode}: {listing.contact_value}
							</Descriptions.Item>
							<Descriptions.Item label={t("discoverDetail.listedAt")}>
								{new Date(listing.listed_at).toLocaleDateString()}
							</Descriptions.Item>
						</Descriptions>
					</Card>

					<Modal
						title={t("discoverDetail.subscribeTitle")}
						open={subscribeModalOpen}
						onOk={handleSubscribe}
						onCancel={() => setSubscribeModalOpen(false)}
						confirmLoading={subscribing}
					>
						<Text>{t("discoverDetail.subscribeConfirmMessage")}</Text>
						<Input.TextArea
							style={{ marginTop: 12 }}
							rows={4}
							placeholder={t("discoverDetail.requestNotePlaceholder")}
							value={requestNote}
							onChange={(e) => setRequestNote(e.target.value)}
							maxLength={2000}
						/>
					</Modal>
				</>
			) : null}
		</div>
	);
}
