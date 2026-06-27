import React, { useState } from "react";
import {
	Card,
	Button,
	Col,
	Row,
	Segmented,
	Space,
	Tag,
	Typography,
	theme,
} from "antd";
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
	const { token } = theme.useToken();
	const [billing, setBilling] = useState<"monthly" | "annual">("annual");

	const pricing = HUB_PLAN_PRICING[regionCode as keyof typeof HUB_PLAN_PRICING];

	return (
		<div>
			<div style={{ textAlign: "center", marginBottom: token.margin }}>
				<Segmented
					value={billing}
					onChange={(v) => setBilling(v as "monthly" | "annual")}
					options={[
						{ label: t("billingMonthly"), value: "monthly" },
						{ label: t("billingAnnual"), value: "annual" },
					]}
				/>
			</div>

			<Row
				gutter={[token.paddingLG, token.paddingLG]}
				justify="center"
				align="stretch"
			>
				{PLAN_ORDER.map((planId) => {
					const price = pricing?.[planId];
					const isCurrent = currentPlanId === planId;
					const isSelected = selectedPlanId === planId;
					const isHighlighted = (isSelected && !!onSelect) || isCurrent;

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
									<Text type="secondary" style={{ fontSize: token.fontSize }}>
										{" "}
										{billing === "monthly" ? t("perMonth") : t("perYear")}
									</Text>
								</Title>
								{billing === "annual" && (
									<Tag color="green" style={{ marginTop: token.marginXS }}>
										{t("saveBadge", {
											percent: annualSavingsPercent(
												price.monthly_minor,
												price.annual_minor
											),
										})}
									</Tag>
								)}
								<div>
									<Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
										{t("plusTaxes")}
									</Text>
								</div>
							</div>
						);
					}

					return (
						<Col xs={24} sm={12} key={planId}>
							<Card
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
									height: "100%",
									border: isHighlighted
										? `${token.lineWidthBold}px solid ${token.colorPrimary}`
										: `${token.lineWidth}px solid ${token.colorBorder}`,
									backgroundColor: isHighlighted
										? token.colorPrimaryBg
										: undefined,
									transition: `all ${token.motionDurationMid} ${token.motionEaseInOut}`,
								}}
							>
								<div style={{ minHeight: "6em" }}>{priceNode}</div>

								<Paragraph
									type="secondary"
									style={{ marginTop: token.marginSM }}
								>
									{t(`desc_${planId}`)}
								</Paragraph>

								{planId === "pro" && (
									<Paragraph style={{ marginTop: token.marginXS }}>
										<HeartFilled
											style={{
												color: token.colorError,
												marginRight: token.marginXS,
											}}
										/>
										{t("supportNote")}
									</Paragraph>
								)}

								<Space
									orientation="vertical"
									size="small"
									style={{ width: "100%" }}
								>
									{PLAN_FEATURES[planId].map((f) => (
										<div key={f.key}>
											{f.included ? (
												<CheckOutlined
													style={{
														color: token.colorSuccess,
														marginRight: token.marginXS,
													}}
												/>
											) : (
												<CloseOutlined
													style={{
														color: token.colorTextDisabled,
														marginRight: token.marginXS,
													}}
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
										style={{ marginTop: token.margin }}
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
										style={{ marginTop: token.margin }}
										onClick={() => onSelect(planId)}
									>
										{isSelected ? t("selected") : t("select")}
									</Button>
								)}
							</Card>
						</Col>
					);
				})}
			</Row>
		</div>
	);
};
