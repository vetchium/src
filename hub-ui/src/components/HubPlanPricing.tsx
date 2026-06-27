import React, { useState } from "react";
import { Card, Button, Segmented, Tag, Typography, Space } from "antd";
import { CheckOutlined, CloseOutlined, HeartFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { HubPlanId } from "vetchium-specs/hub/plans";
import { HUB_PLAN_PRICING } from "../config/pricing";
import { formatCurrency, annualSavingsPercent } from "../utils/currencyFormat";

const { Title, Text, Paragraph } = Typography;

// Fixed display order for the hub plan cards.
const PLAN_ORDER: HubPlanId[] = ["free", "pro"];

// Capability rows shown per plan. These are display/marketing copy mirroring the
// server-enforced matrix (Spec 17 §7); the backend remains the source of truth.
const PLAN_FEATURES: Record<HubPlanId, { key: string; included: boolean }[]> = {
	free: [
		{ key: "featureBrowse", included: true },
		{ key: "featureApply", included: true },
		{ key: "featureConnections", included: true },
		{ key: "featurePicture", included: false },
		{ key: "featurePosts", included: false },
	],
	pro: [
		{ key: "featureBrowse", included: true },
		{ key: "featureApply", included: true },
		{ key: "featureConnections", included: true },
		{ key: "featurePicture", included: true },
		{ key: "featurePosts", included: true },
	],
};

interface HubPlanPricingProps {
	regionCode: string;
	// When provided, renders the current-plan state + switch buttons (PlanPage).
	currentPlanId?: HubPlanId;
	onSwitch?: (planId: HubPlanId) => void;
	switching?: boolean;
	// When provided (signup), renders Select/Selected buttons that pick a plan
	// to grant at signup (controlled by selectedPlanId).
	selectedPlanId?: HubPlanId;
	onSelect?: (planId: HubPlanId) => void;
}

export const HubPlanPricing: React.FC<HubPlanPricingProps> = ({
	regionCode,
	currentPlanId,
	onSwitch,
	switching,
	selectedPlanId,
	onSelect,
}) => {
	const { t, i18n } = useTranslation("plan");
	const [billing, setBilling] = useState<"monthly" | "annual">("annual");

	const pricing = HUB_PLAN_PRICING[regionCode as keyof typeof HUB_PLAN_PRICING];

	return (
		<div>
			<div style={{ textAlign: "center", marginBottom: 16 }}>
				<Segmented
					value={billing}
					onChange={(v) => setBilling(v as "monthly" | "annual")}
					options={[
						{ label: t("billingMonthly"), value: "monthly" },
						{ label: t("billingAnnual"), value: "annual" },
					]}
				/>
			</div>

			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 16,
					justifyContent: "center",
					alignItems: "stretch",
				}}
			>
				{PLAN_ORDER.map((planId) => {
					const price = pricing?.[planId];
					const isCurrent = currentPlanId === planId;
					const isSelected = selectedPlanId === planId;

					let priceNode: React.ReactNode = null;
					if (!price || price === "free") {
						priceNode = (
							<Title level={3} style={{ margin: 0 }}>
								{t("free")}
							</Title>
						);
					} else if (price === "contact") {
						priceNode = (
							<Title level={3} style={{ margin: 0 }}>
								{t("contactUs")}
							</Title>
						);
					} else {
						const amount =
							billing === "monthly" ? price.monthly_minor : price.annual_minor;
						priceNode = (
							<div>
								<Title level={3} style={{ margin: 0 }}>
									{formatCurrency(amount, regionCode, i18n.language)}
									<Text type="secondary" style={{ fontSize: 14 }}>
										{" "}
										{billing === "monthly" ? t("perMonth") : t("perYear")}
									</Text>
								</Title>
								{billing === "annual" && (
									<Tag color="green" style={{ marginTop: 8 }}>
										{t("saveBadge", {
											percent: annualSavingsPercent(
												price.monthly_minor,
												price.annual_minor
											),
										})}
									</Tag>
								)}
								<div>
									<Text type="secondary" style={{ fontSize: 12 }}>
										{t("plusTaxes")}
									</Text>
								</div>
							</div>
						);
					}

					return (
						<Card
							key={planId}
							title={
								<Space>
									{t(`plan_${planId}`)}
									{isCurrent && <Tag color="blue">{t("current")}</Tag>}
									{isSelected && onSelect && (
										<Tag color="blue">{t("selected")}</Tag>
									)}
									{planId === "pro" && (
										<Tag color="gold">{t("recommended")}</Tag>
									)}
								</Space>
							}
							style={{
								flex: "1 1 260px",
								minWidth: 260,
								maxWidth: 360,
								borderColor:
									(isSelected && onSelect) || isCurrent ? "#1890ff" : undefined,
							}}
						>
							<div style={{ minHeight: 96 }}>{priceNode}</div>

							<Paragraph type="secondary" style={{ marginTop: 12 }}>
								{t(`desc_${planId}`)}
							</Paragraph>

							{planId === "pro" && (
								<Paragraph style={{ marginTop: 8 }}>
									<HeartFilled style={{ color: "#eb2f96", marginRight: 6 }} />
									{t("supportNote")}
								</Paragraph>
							)}

							<Space orientation="vertical" size={4} style={{ width: "100%" }}>
								{PLAN_FEATURES[planId].map((f) => (
									<div key={f.key}>
										{f.included ? (
											<CheckOutlined
												style={{ color: "#52c41a", marginRight: 8 }}
											/>
										) : (
											<CloseOutlined
												style={{ color: "#bfbfbf", marginRight: 8 }}
											/>
										)}
										<Text type={f.included ? undefined : "secondary"}>
											{t(f.key)}
										</Text>
									</div>
								))}
							</Space>

							{onSwitch && (
								<Button
									type={planId === "pro" ? "primary" : "default"}
									block
									style={{ marginTop: 16 }}
									disabled={isCurrent || switching}
									loading={switching}
									onClick={() => onSwitch(planId)}
								>
									{isCurrent
										? t("current")
										: t("switchTo", { plan: t(`plan_${planId}`) })}
								</Button>
							)}

							{onSelect && (
								<Button
									type={isSelected ? "primary" : "default"}
									block
									style={{ marginTop: 16 }}
									onClick={() => onSelect(planId)}
								>
									{isSelected ? t("selected") : t("select")}
								</Button>
							)}
						</Card>
					);
				})}
			</div>
		</div>
	);
};
