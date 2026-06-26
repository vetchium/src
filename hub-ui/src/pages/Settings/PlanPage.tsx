import React, { useCallback, useEffect, useState } from "react";
import { Button, Spin, Typography, message, Alert } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { HubPlanId } from "vetchium-specs/hub/plans";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo, clearMyInfoCache } from "../../hooks/useMyInfo";
import * as api from "../../lib/api-client";
import { HubPlanPricing } from "../../components/HubPlanPricing";

const { Title } = Typography;

export const PlanPage: React.FC = () => {
	const { t } = useTranslation("plan");
	const { sessionToken } = useAuth();
	const { data: myInfo, loading: loadingInfo } = useMyInfo(sessionToken);
	const [currentPlan, setCurrentPlan] = useState<HubPlanId | undefined>(
		undefined
	);
	const [switching, setSwitching] = useState(false);

	useEffect(() => {
		if (myInfo) setCurrentPlan(myInfo.plan_id);
	}, [myInfo]);

	const handleSwitch = useCallback(
		async (planId: HubPlanId) => {
			if (!sessionToken) return;
			setSwitching(true);
			try {
				const res = await api.switchPlan(sessionToken, { plan_id: planId });
				if (res.status === 200 && res.data) {
					setCurrentPlan(res.data.plan_id);
					// Drop the cached myinfo so picture-upload gating refreshes everywhere.
					clearMyInfoCache();
					message.success(t("switchSuccess"));
				} else {
					message.error(t("switchError"));
				}
			} catch {
				message.error(t("switchError"));
			} finally {
				setSwitching(false);
			}
		},
		[sessionToken, t]
	);

	const regionCode = myInfo?.home_region ?? "";

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
				{t("title")}
			</Title>

			<Spin spinning={loadingInfo}>
				{!loadingInfo && !regionCode ? (
					<Alert type="warning" showIcon description={t("noRegion")} />
				) : (
					regionCode && (
						<HubPlanPricing
							regionCode={regionCode}
							currentPlanId={currentPlan}
							onSwitch={handleSwitch}
							switching={switching}
						/>
					)
				)}
			</Spin>
		</div>
	);
};
