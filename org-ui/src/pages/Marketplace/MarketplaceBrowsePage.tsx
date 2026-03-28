import {
	App,
	Button,
	Card,
	Col,
	Form,
	Input,
	Modal,
	Row,
	Select,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	BrowseMarketplaceServiceListingsRequest,
	ReportMarketplaceServiceListingRequest,
	ServiceListingSummary,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export function MarketplaceBrowsePage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [listings, setListings] = useState<ServiceListingSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
	const [keyword, setKeyword] = useState("");
	const [searchInput, setSearchInput] = useState("");

	const [reportModalOpen, setReportModalOpen] = useState(false);
	const [reportLoading, setReportLoading] = useState(false);
	const [reportListing, setReportListing] =
		useState<ServiceListingSummary | null>(null);
	const [reportReason, setReportReason] = useState<string>("");
	const [reportOther, setReportOther] = useState("");

	const loadListings = useCallback(
		async (cursor?: string, reset?: boolean, kw?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: BrowseMarketplaceServiceListingsRequest = {
					...(kw ? { keyword: kw } : {}),
					...(cursor ? { cursor } : {}),
				};
				const resp = await fetch(
					`${baseUrl}/org/browse-marketplace-service-listings`,
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
					const data = await resp.json();
					const items: ServiceListingSummary[] = data.service_listings ?? [];
					if (reset) {
						setListings(items);
					} else {
						setListings((prev) => [...prev, ...items]);
					}
					setNextCursor(data.next_cursor ?? undefined);
				} else {
					message.error(t("browse.errors.loadFailed"));
				}
			} catch {
				message.error(t("browse.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	useEffect(() => {
		loadListings(undefined, true, keyword);
	}, [loadListings, keyword]);

	const handleSearch = () => {
		setKeyword(searchInput);
		setNextCursor(undefined);
	};

	const handleReport = async () => {
		if (!sessionToken || !reportListing) return;
		if (!reportReason) {
			message.error(t("browse.errors.reasonRequired"));
			return;
		}
		if (reportReason === "other" && !reportOther.trim()) {
			message.error(t("browse.errors.reasonOtherRequired"));
			return;
		}
		if (reportOther.length > 500) {
			message.error(t("browse.errors.reasonOtherTooLong"));
			return;
		}
		setReportLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: ReportMarketplaceServiceListingRequest = {
				service_listing_id: reportListing.service_listing_id,
				home_region: reportListing.home_region,
				reason:
					reportReason as ReportMarketplaceServiceListingRequest["reason"],
				...(reportReason === "other" && reportOther
					? { reason_other: reportOther }
					: {}),
			};
			const resp = await fetch(
				`${baseUrl}/org/report-marketplace-service-listing`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (resp.status === 200 || resp.status === 201) {
				message.success(t("browse.success.reported"));
				setReportModalOpen(false);
				setReportListing(null);
				setReportReason("");
				setReportOther("");
			} else if (resp.status === 409) {
				message.error(t("browse.errors.alreadyReported"));
			} else if (resp.status === 403) {
				message.error(t("browse.errors.ownListing"));
			} else {
				message.error(t("browse.errors.reportFailed"));
			}
		} catch {
			message.error(t("browse.errors.reportFailed"));
		} finally {
			setReportLoading(false);
		}
	};

	const reportReasonOptions = [
		"misleading_information",
		"fraudulent",
		"inappropriate_content",
		"spam",
		"other",
	].map((v) => ({ value: v, label: t(`browse.reportReasons.${v}`) }));

	return (
		<div>
			<Title level={4}>{t("browse.title")}</Title>

			<div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
				<Input
					placeholder={t("browse.searchPlaceholder")}
					value={searchInput}
					onChange={(e) => setSearchInput(e.target.value)}
					onPressEnter={handleSearch}
					style={{ maxWidth: 400 }}
					allowClear
					onClear={() => {
						setSearchInput("");
						setKeyword("");
					}}
				/>
				<Button type="primary" onClick={handleSearch}>
					Search
				</Button>
			</div>

			<Spin spinning={loading}>
				{listings.length === 0 && !loading ? (
					<Text type="secondary">{t("browse.noResults")}</Text>
				) : (
					<Row gutter={[16, 16]}>
						{listings.map((listing) => (
							<Col key={listing.service_listing_id} xs={24} sm={12} lg={8}>
								<Card
									hoverable
									style={{
										height: "100%",
										display: "flex",
										flexDirection: "column",
									}}
									actions={[
										<Button
											key="contact"
											type="link"
											href={listing.service_listing_id}
											target="_blank"
											rel="noopener noreferrer"
										>
											{t("browse.contactProvider")}
										</Button>,
										<Button
											key="report"
											type="link"
											danger
											onClick={() => {
												setReportListing(listing);
												setReportReason("");
												setReportOther("");
												setReportModalOpen(true);
											}}
										>
											{t("browse.report")}
										</Button>,
									]}
								>
									<Card.Meta
										title={listing.name}
										description={
											<div>
												<Tag color="blue">
													{t(`browse.categories.${listing.service_category}`)}
												</Tag>
												<Paragraph
													ellipsis={{ rows: 2 }}
													style={{ marginTop: 8, marginBottom: 4 }}
												>
													{listing.short_blurb}
												</Paragraph>
												<Text type="secondary" style={{ fontSize: 12 }}>
													{listing.org_name}
												</Text>
												<br />
												<Text type="secondary" style={{ fontSize: 12 }}>
													{listing.countries_of_service.join(", ")}
												</Text>
											</div>
										}
									/>
								</Card>
							</Col>
						))}
					</Row>
				)}
			</Spin>

			{nextCursor && (
				<Button
					onClick={() => loadListings(nextCursor, false, keyword)}
					loading={loading}
					block
					style={{ marginTop: 16 }}
				>
					{t("browse.loadMore")}
				</Button>
			)}

			{/* Report Modal */}
			<Modal
				title={t("browse.reportTitle")}
				open={reportModalOpen}
				onCancel={() => {
					setReportModalOpen(false);
					setReportListing(null);
					setReportReason("");
					setReportOther("");
				}}
				footer={null}
				destroyOnHidden
			>
				<Spin spinning={reportLoading}>
					<Form layout="vertical">
						<Form.Item label={t("browse.reportReason")} required>
							<Select
								options={reportReasonOptions}
								value={reportReason || undefined}
								onChange={(val) => {
									setReportReason(val);
									if (val !== "other") setReportOther("");
								}}
								placeholder={t("browse.errors.reasonRequired")}
							/>
						</Form.Item>
						{reportReason === "other" && (
							<Form.Item label={t("browse.reportDetails")} required>
								<TextArea
									rows={3}
									placeholder={t("browse.reportDetailsPlaceholder")}
									value={reportOther}
									onChange={(e) => setReportOther(e.target.value)}
									maxLength={550}
								/>
								{reportOther.length > 500 && (
									<Text type="danger">
										{t("browse.errors.reasonOtherTooLong")}
									</Text>
								)}
							</Form.Item>
						)}
						<Button
							type="primary"
							loading={reportLoading}
							disabled={
								!reportReason ||
								(reportReason === "other" &&
									(!reportOther.trim() || reportOther.length > 500))
							}
							onClick={handleReport}
							block
						>
							{t("browse.reportSubmit")}
						</Button>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
