import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import {
	Alert,
	Button,
	Card,
	Col,
	Row,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { getApiBaseUrl } from "../../config";
import type {
	DiscoverListingsRequest,
	DiscoverListingsResponse,
	MarketplaceListingCard,
} from "vetchium-specs/org/marketplace";

const { Title, Text, Paragraph } = Typography;

export function MarketplaceDiscoverPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();

	const [listings, setListings] = useState<MarketplaceListingCard[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [paginationKey, setPaginationKey] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);

	const fetchListings = useCallback(
		async (cursor: string | null, append: boolean) => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const reqBody: DiscoverListingsRequest = {
					limit: 20,
					...(cursor && { pagination_key: cursor }),
				};
				const resp = await fetch(
					`${apiBaseUrl}/org/marketplace/discover/list`,
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
					const data: DiscoverListingsResponse = await resp.json();
					setListings((prev) =>
						append ? [...prev, ...data.listings] : data.listings
					);
					setPaginationKey(data.next_pagination_key ?? null);
					setError(null);
				} else {
					setError(t("discover.errors.loadFailed"));
				}
			} catch {
				setError(t("discover.errors.loadFailed"));
			} finally {
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[sessionToken, t]
	);

	useEffect(() => {
		fetchListings(null, false);
	}, [fetchListings]);

	const handleLoadMore = () => {
		if (!paginationKey) return;
		setLoadingMore(true);
		fetchListings(paginationKey, true);
	};

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
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("discover.title")}
			</Title>

			{loading ? (
				<Spin size="large" />
			) : error ? (
				<Alert type="error" title={error} />
			) : listings.length === 0 ? (
				<Text type="secondary">{t("discover.noListings")}</Text>
			) : (
				<>
					<Row gutter={[16, 16]}>
						{listings.map((listing) => (
							<Col key={listing.listing_id} xs={24} sm={12} lg={8}>
								<Card
									hoverable
									style={{ height: "100%", cursor: "pointer" }}
									onClick={() =>
										navigate(`/marketplace/discover/${listing.listing_id}`)
									}
								>
									<Title level={5} style={{ marginBottom: 4 }}>
										{listing.headline}
									</Title>
									<Space style={{ marginBottom: 8 }}>
										<Tag color="blue">{listing.capability_id}</Tag>
										<Tag>{listing.org_domain}</Tag>
									</Space>
									<Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 8 }}>
										{listing.description}
									</Paragraph>
								</Card>
							</Col>
						))}
					</Row>

					{paginationKey && (
						<div style={{ textAlign: "center", marginTop: 24 }}>
							<Button onClick={handleLoadMore} loading={loadingMore}>
								{t("discover.loadMore")}
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
