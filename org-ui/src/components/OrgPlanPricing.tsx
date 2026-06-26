import React, { useState } from "react";
import {
	Card,
	Segmented,
	Tag,
	Typography,
	Space,
	Row,
	Col,
	Divider,
} from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { OrgPlanId } from "vetchium-specs/org/tiers";
import { ORG_PLAN_PRICING } from "../config/pricing";
import { formatCurrency, annualSavingsPercent } from "../utils/currencyFormat";

const { Title, Text, Paragraph } = Typography;

const PLAN_ORDER: OrgPlanId[] = ["free", "silver", "gold", "enterprise"];

// Per-plan feature rows, mirroring the server-enforced cap matrix (Spec 17 §7).
// Display/marketing copy only — the backend remains the source of truth.
type FeatureRow = { key: string; count?: number };
const PLAN_FEATURES: Record<OrgPlanId, FeatureRow[]> = {
	free: [
		{ key: "featureOrgUsers", count: 5 },
		{ key: "featureDomains", count: 2 },
		{ key: "featureAudit", count: 30 },
	],
	silver: [
		{ key: "featureOrgUsers", count: 25 },
		{ key: "featureDomains", count: 5 },
		{ key: "featureSuborgs", count: 3 },
		{ key: "featureListings", count: 5 },
		{ key: "featureAudit", count: 365 },
	],
	gold: [
		{ key: "featureOrgUsers", count: 100 },
		{ key: "featureDomainsUnlimited" },
		{ key: "featureSuborgs", count: 10 },
		{ key: "featureListings", count: 20 },
		{ key: "featureAudit", count: 1095 },
		{ key: "featureMcp" },
	],
	enterprise: [
		{ key: "featureOrgUsersUnlimited" },
		{ key: "featureDomainsUnlimited" },
		{ key: "featureSuborgsUnlimited" },
		{ key: "featureListingsUnlimited" },
		{ key: "featureAuditUnlimited" },
		{ key: "featureMcp" },
	],
};

interface OrgPlanPricingProps {
	regionCode: string;
}

export const OrgPlanPricing: React.FC<OrgPlanPricingProps> = ({
	regionCode,
}) => {
	const { t, i18n } = useTranslation("plan");
	const [billing, setBilling] = useState<"monthly" | "annual">("annual");

	const pricing = ORG_PLAN_PRICING[regionCode as keyof typeof ORG_PLAN_PRICING];

	return (
		<div>
			<div style={{ textAlign: "center", marginBottom: 16 }}>
				<Segmented
					value={billing}
					onChange={(v) => setBilling(v as "monthly" | "annual")}
					options={[
						{ label: t("pricing.billingMonthly"), value: "monthly" },
						{ label: t("pricing.billingAnnual"), value: "annual" },
					]}
				/>
			</div>

			<Row gutter={[16, 16]}>
				{PLAN_ORDER.map((planId) => {
					const price = pricing?.[planId];

					let priceNode: React.ReactNode;
					if (!price || price === "free") {
						priceNode = (
							<Title level={4} style={{ margin: 0 }}>
								{t("pricing.free")}
							</Title>
						);
					} else if (price === "contact") {
						priceNode = (
							<Title level={4} style={{ margin: 0 }}>
								{t("pricing.contactUs")}
							</Title>
						);
					} else {
						const amount =
							billing === "monthly" ? price.monthly_minor : price.annual_minor;
						priceNode = (
							<div>
								<Title level={4} style={{ margin: 0 }}>
									{formatCurrency(amount, regionCode, i18n.language)}
									<Text type="secondary" style={{ fontSize: 13 }}>
										{" "}
										{billing === "monthly"
											? t("pricing.perMonth")
											: t("pricing.perYear")}
									</Text>
								</Title>
								{billing === "annual" && (
									<Tag color="green" style={{ marginTop: 6 }}>
										{t("pricing.saveBadge", {
											percent: annualSavingsPercent(
												price.monthly_minor,
												price.annual_minor
											),
										})}
									</Tag>
								)}
								<div>
									<Text type="secondary" style={{ fontSize: 12 }}>
										{t("pricing.plusTaxes")}
									</Text>
								</div>
							</div>
						);
					}

					return (
						<Col key={planId} xs={24} sm={12} lg={6}>
							<Card
								title={
									<Space>
										{t(`pricing.plan_${planId}`)}
										{planId === "gold" && (
											<Tag color="gold">{t("pricing.recommended")}</Tag>
										)}
									</Space>
								}
								style={{ height: "100%" }}
							>
								<div style={{ minHeight: 84 }}>{priceNode}</div>

								<Space
									orientation="vertical"
									size={4}
									style={{ width: "100%" }}
								>
									{PLAN_FEATURES[planId].map((f) => (
										<div key={f.key}>
											<CheckOutlined
												style={{ color: "#52c41a", marginRight: 8 }}
											/>
											<Text>
												{f.count !== undefined
													? t(`pricing.${f.key}`, { count: f.count })
													: t(`pricing.${f.key}`)}
											</Text>
										</div>
									))}
								</Space>

								{planId === "enterprise" && (
									<>
										<Divider style={{ margin: "12px 0" }} />
										<Text strong>{t("pricing.comingSoon")}</Text>
										<Paragraph
											type="secondary"
											style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}
										>
											{t("pricing.comingSoonMcp")}
											<br />
											{t("pricing.comingSoonMore")}
										</Paragraph>
									</>
								)}
							</Card>
						</Col>
					);
				})}
			</Row>
		</div>
	);
};
