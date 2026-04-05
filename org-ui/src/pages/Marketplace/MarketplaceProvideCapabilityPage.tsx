import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Card,
	Descriptions,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	MarketplaceEnrollment,
	MarketplaceOffer,
	ArchiveProviderOfferRequest,
	SubmitProviderOfferRequest,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title, Text } = Typography;

function enrollmentStatusColor(status: string): string {
	switch (status) {
		case "approved":
			return "green";
		case "pending_review":
			return "gold";
		case "rejected":
			return "red";
		case "suspended":
			return "orange";
		case "expired":
			return "default";
		default:
			return "default";
	}
}

function offerStatusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "pending_review":
			return "gold";
		case "draft":
			return "default";
		case "rejected":
		case "suspended":
			return "red";
		case "archived":
			return "default";
		default:
			return "default";
	}
}

export function MarketplaceProvideCapabilityPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();
	const navigate = useNavigate();
	const { capability_slug } = useParams<{ capability_slug: string }>();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

	const [enrollment, setEnrollment] = useState<MarketplaceEnrollment | null>(
		null
	);
	const [offer, setOffer] = useState<MarketplaceOffer | null>(null);
	const [enrollmentLoading, setEnrollmentLoading] = useState(false);
	const [offerLoading, setOfferLoading] = useState(false);
	const [actionLoading, setActionLoading] = useState(false);

	const loadEnrollment = useCallback(async () => {
		if (!sessionToken || !capability_slug) return;
		setEnrollmentLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/provider-enrollments/get`,
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
				const data: MarketplaceEnrollment = await resp.json();
				setEnrollment(data);
			} else if (resp.status === 404) {
				setEnrollment(null);
			} else {
				message.error(t("provideCapability.errors.loadFailed"));
			}
		} catch {
			message.error(t("provideCapability.errors.loadFailed"));
		} finally {
			setEnrollmentLoading(false);
		}
	}, [sessionToken, capability_slug, message, t]);

	const loadOffer = useCallback(async () => {
		if (!sessionToken || !capability_slug) return;
		setOfferLoading(true);
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
				setOffer(data);
			} else if (resp.status === 404) {
				setOffer(null);
			}
		} catch {
			// ignore offer load error
		} finally {
			setOfferLoading(false);
		}
	}, [sessionToken, capability_slug]);

	useEffect(() => {
		loadEnrollment();
		loadOffer();
	}, [loadEnrollment, loadOffer]);

	const handleSubmitOffer = async () => {
		if (!sessionToken || !capability_slug) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: SubmitProviderOfferRequest = { capability_slug };
			const resp = await fetch(
				`${baseUrl}/org/marketplace/provider-offers/submit`,
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
				message.success(t("provideCapability.success.submitted"));
				loadOffer();
			} else {
				message.error(t("provideCapability.errors.submitFailed"));
			}
		} catch {
			message.error(t("provideCapability.errors.submitFailed"));
		} finally {
			setActionLoading(false);
		}
	};

	const handleArchiveOffer = async () => {
		if (!sessionToken || !capability_slug) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: ArchiveProviderOfferRequest = { capability_slug };
			const resp = await fetch(
				`${baseUrl}/org/marketplace/provider-offers/archive`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (resp.status === 200 || resp.status === 204) {
				message.success(t("provideCapability.success.archived"));
				loadOffer();
			} else {
				message.error(t("provideCapability.errors.archiveFailed"));
			}
		} catch {
			message.error(t("provideCapability.errors.archiveFailed"));
		} finally {
			setActionLoading(false);
		}
	};

	const canApplyEnrollment =
		!enrollment ||
		enrollment.status === "rejected" ||
		enrollment.status === "expired";

	const isEnrollmentApproved = enrollment?.status === "approved";

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
				<Link to="/marketplace/provide">
					<Button icon={<ArrowLeftOutlined />}>
						{t("provideCapability.backToProvide")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{capability_slug}
			</Title>

			{/* Enrollment Section */}
			<Card
				title={t("provideCapability.enrollmentTitle")}
				style={{ marginBottom: 24 }}
				extra={
					enrollment && (
						<Tag color={enrollmentStatusColor(enrollment.status)}>
							{t(`provide.enrollmentStatuses.${enrollment.status}`)}
						</Tag>
					)
				}
			>
				<Spin spinning={enrollmentLoading}>
					{!enrollment && !enrollmentLoading && (
						<Text type="secondary">{t("provideCapability.noEnrollment")}</Text>
					)}
					{enrollment && (
						<Descriptions column={{ xs: 1, sm: 2 }} size="small">
							{enrollment.approved_at && (
								<Descriptions.Item
									label={t("provideCapability.approvedAt")}
								>
									{new Date(enrollment.approved_at).toLocaleString()}
								</Descriptions.Item>
							)}
							{enrollment.expires_at && (
								<Descriptions.Item label={t("provideCapability.expiresAt")}>
									{new Date(enrollment.expires_at).toLocaleString()}
								</Descriptions.Item>
							)}
							{enrollment.review_note && (
								<Descriptions.Item
									label={t("provideCapability.reviewNote")}
									span={2}
								>
									{enrollment.review_note}
								</Descriptions.Item>
							)}
							{enrollment.application_note && (
								<Descriptions.Item
									label={t("provideCapability.applicationNote")}
									span={2}
								>
									{enrollment.application_note}
								</Descriptions.Item>
							)}
						</Descriptions>
					)}
					{canManage && canApplyEnrollment && (
						<div style={{ marginTop: 16 }}>
							<Button
								type="primary"
								onClick={() =>
									navigate(
										`/marketplace/provide/${capability_slug}/apply`
									)
								}
							>
								{enrollment
									? t("provideCapability.reapplyButton")
									: t("provideCapability.applyButton")}
							</Button>
						</div>
					)}
				</Spin>
			</Card>

			{/* Offer Section */}
			{isEnrollmentApproved && (
				<Card
					title={t("provideCapability.offerTitle")}
					style={{ marginBottom: 24 }}
					extra={
						offer && (
							<Tag color={offerStatusColor(offer.status)}>
								{t(`provideCapability.offerStatuses.${offer.status}`)}
							</Tag>
						)
					}
				>
					<Spin spinning={offerLoading}>
						{!offer && !offerLoading && (
							<Text type="secondary">{t("provideCapability.noOffer")}</Text>
						)}
						{offer && (
							<>
								<Text strong>{offer.headline}</Text>
								<br />
								<Text type="secondary">{offer.summary}</Text>
								{offer.review_note && (
									<div style={{ marginTop: 8 }}>
										<Text type="secondary">
											{t("provideCapability.reviewNote")}:{" "}
										</Text>
										<Text>{offer.review_note}</Text>
									</div>
								)}
							</>
						)}
						{canManage && (
							<Space style={{ marginTop: 16 }} wrap>
								{!offer && (
									<Button
										type="primary"
										onClick={() =>
											navigate(
												`/marketplace/provide/${capability_slug}/offer/edit`
											)
										}
									>
										{t("provideCapability.createOfferButton")}
									</Button>
								)}
								{offer && (
									<Button
										onClick={() =>
											navigate(
												`/marketplace/provide/${capability_slug}/offer`
											)
										}
									>
										{t("provideCapability.editOfferButton")}
									</Button>
								)}
								{offer && offer.status === "draft" && (
									<Button
										type="primary"
										loading={actionLoading}
										onClick={handleSubmitOffer}
									>
										{t("provideCapability.submitOfferButton")}
									</Button>
								)}
								{offer &&
									(offer.status === "draft" ||
										offer.status === "rejected") && (
										<Button
											danger
											loading={actionLoading}
											onClick={handleArchiveOffer}
										>
											{t("provideCapability.archiveOfferButton")}
										</Button>
									)}
							</Space>
						)}
					</Spin>
				</Card>
			)}

			{/* Activity */}
			{isEnrollmentApproved && (
				<div>
					<Button
						onClick={() =>
							navigate(
								`/marketplace/provide/${capability_slug}/activity`
							)
						}
					>
						{t("provideCapability.viewActivityButton")}
					</Button>
				</div>
			)}
		</div>
	);
}
