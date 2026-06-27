import React, { useState } from "react";
import { Button, Card, Segmented, Tag, Typography, Space, Divider } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { OrgPlanId, Plan } from "vetchium-specs/org/tiers";
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
	// When provided (settings plan page), renders the current-plan badge +
	// per-card upgrade buttons. Omitted on the public/display-only pricing page.
	currentPlanId?: OrgPlanId;
	// Authoritative plan rows from /org/list-plans — used for self_upgradeable +
	// display_order so upgrade eligibility matches the backend exactly.
	plans?: Plan[];
	onUpgrade?: (planId: OrgPlanId) => void;
	upgrading?: boolean;
	// When provided (signup), renders Select/Selected buttons that pick a plan
	// to grant at signup. Enterprise stays "Contact us" (never self-served).
	selectedPlanId?: OrgPlanId;
	onSelect?: (planId: OrgPlanId) => void;
}

export const OrgPlanPricing: React.FC<OrgPlanPricingProps> = ({
	regionCode,
	currentPlanId,
	plans,
	onUpgrade,
	upgrading,
	selectedPlanId,
	onSelect,
}) => {
	const { t, i18n } = useTranslation("plan");
	const [billing, setBilling] = useState<"monthly" | "annual">("annual");

	const pricing = ORG_PLAN_PRICING[regionCode as keyof typeof ORG_PLAN_PRICING];
	const currentOrder =
		plans?.find((p) => p.plan_id === currentPlanId)?.display_order ?? -1;

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

			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 16,
					alignItems: "stretch",
				}}
			>
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

					const apiPlan = plans?.find((p) => p.plan_id === planId);
					const isCurrent = currentPlanId === planId;
					const isSelected = selectedPlanId === planId;
					const canUpgrade =
						!!onUpgrade &&
						!!apiPlan?.self_upgradeable &&
						apiPlan.display_order > currentOrder;
					// Enterprise is admin-assigned, never self-served at signup.
					const canSelect = !!onSelect && planId !== "enterprise";

					return (
						<Card
							key={planId}
							title={
								<Space>
									{t(`pricing.plan_${planId}`)}
									{isCurrent && (
										<Tag color="blue">{t("pricing.currentBadge")}</Tag>
									)}
									{isSelected && onSelect && (
										<Tag color="blue">{t("pricing.selectedBadge")}</Tag>
									)}
									{planId === "gold" && (
										<Tag color="gold">{t("pricing.recommended")}</Tag>
									)}
								</Space>
							}
							style={{
								flex: "1 1 220px",
								minWidth: 220,
								maxWidth: 340,
								borderColor:
									(isSelected && onSelect) || isCurrent ? "#1890ff" : undefined,
							}}
						>
							<div style={{ minHeight: 84 }}>{priceNode}</div>

							<Space orientation="vertical" size={4} style={{ width: "100%" }}>
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

							{onUpgrade &&
								(isCurrent ? (
									<Button block disabled style={{ marginTop: 16 }}>
										{t("pricing.currentPlanButton")}
									</Button>
								) : canUpgrade ? (
									<Button
										type="primary"
										block
										style={{ marginTop: 16 }}
										loading={upgrading}
										onClick={() => onUpgrade(planId)}
									>
										{t("pricing.upgradeButton", {
											plan: t(`pricing.plan_${planId}`),
										})}
									</Button>
								) : null)}

							{onSelect &&
								(canSelect ? (
									<Button
										type={isSelected ? "primary" : "default"}
										block
										style={{ marginTop: 16 }}
										onClick={() => onSelect(planId)}
									>
										{isSelected
											? t("pricing.selectedBadge")
											: t("pricing.selectButton")}
									</Button>
								) : (
									<Button block disabled style={{ marginTop: 16 }}>
										{t("pricing.contactUs")}
									</Button>
								))}
						</Card>
					);
				})}
			</div>
		</div>
	);
};
