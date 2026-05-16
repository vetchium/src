import { UserOutlined } from "@ant-design/icons";
import { Avatar, Button, Spin, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ProfileActionsPanel } from "../../components/profile/ProfileActionsPanel";
import { AboutSection } from "../../components/profile/sections/AboutSection";
import { WorkHistorySection } from "../../components/profile/sections/WorkHistorySection";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { COUNTRIES } from "../../lib/countries";
import type { HubProfilePublicView } from "vetchium-specs/hub/profile";
import type {
	ListPublicEmployerStintsRequest,
	PublicEmployerStint,
} from "vetchium-specs/hub/work-emails";
import type { ConnectionState } from "vetchium-specs/hub/connections";

const { Title, Text } = Typography;

export function ProfilePage() {
	const { t, i18n } = useTranslation("profile");
	const { handle } = useParams<{ handle: string }>();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const [profile, setProfile] = useState<HubProfilePublicView | null>(null);
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);
	const [employerStints, setEmployerStints] = useState<PublicEmployerStint[]>(
		[]
	);
	const [connectionState, setConnectionState] =
		useState<ConnectionState | null>(null);

	const isOwnProfile = myInfo?.handle === handle;

	const getPreferredDisplayName = useCallback(
		(displayNames: HubProfilePublicView["display_names"]): string => {
			if (!displayNames || displayNames.length === 0) return handle ?? "";
			const locale = i18n.language;
			const localeMatch = displayNames.find(
				(dn) => dn.language_code === locale
			);
			if (localeMatch) return localeMatch.display_name;
			const preferred = displayNames.find((dn) => dn.is_preferred);
			if (preferred) return preferred.display_name;
			return displayNames[0]?.display_name ?? handle ?? "";
		},
		[handle, i18n.language]
	);

	useEffect(() => {
		const run = async () => {
			if (!sessionToken || !handle) {
				setNotFound(true);
				setLoading(false);
				return;
			}

			try {
				const apiBaseUrl = await getApiBaseUrl();

				const [profileResponse, stintsResponse] = await Promise.all([
					fetch(`${apiBaseUrl}/hub/get-profile`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify({ handle }),
					}),
					fetch(`${apiBaseUrl}/hub/list-public-employer-stints`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify({ handle } as ListPublicEmployerStintsRequest),
					}),
				]);

				if (profileResponse.status === 404) {
					setNotFound(true);
					setLoading(false);
					return;
				}

				if (profileResponse.status !== 200) {
					setNotFound(true);
					setLoading(false);
					return;
				}

				const profileData: HubProfilePublicView = await profileResponse.json();
				setProfile(profileData);

				if (stintsResponse.status === 200) {
					const stintsData = await stintsResponse.json();
					setEmployerStints(stintsData.stints || []);
				}

				if (!isOwnProfile) {
					const statusResponse = await fetch(
						`${apiBaseUrl}/hub/connections/get-status`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${sessionToken}`,
							},
							body: JSON.stringify({ handle }),
						}
					);

					if (statusResponse.status === 200) {
						const statusData = await statusResponse.json();
						setConnectionState(statusData.connection_state);
					}
				}

				setLoading(false);
			} catch {
				setNotFound(true);
				setLoading(false);
			}
		};

		run();
	}, [sessionToken, handle, isOwnProfile]);

	if (loading) {
		return (
			<div
				style={{
					width: "100%",
					maxWidth: 800,
					padding: "24px 16px",
					alignSelf: "flex-start",
				}}
			>
				<Spin spinning />
			</div>
		);
	}

	if (notFound || !profile) {
		return (
			<div
				style={{
					width: "100%",
					maxWidth: 800,
					padding: "24px 16px",
					alignSelf: "flex-start",
				}}
			>
				<Title level={2}>{t("publicProfile.userNotFound")}</Title>
				<Text type="secondary">
					{t("publicProfile.userNotFoundDesc", { handle: handle })}
				</Text>
			</div>
		);
	}

	const displayName = getPreferredDisplayName(profile.display_names);
	const countryName = profile.resident_country_code
		? (COUNTRIES.find((c) => c.code === profile.resident_country_code)?.name ??
			profile.resident_country_code)
		: null;
	const locationText = [profile.city, countryName].filter(Boolean).join(", ");

	const sections = [];

	if (profile.long_bio || isOwnProfile) {
		sections.push(
			<AboutSection
				key="about"
				longBio={profile.long_bio}
				isOwner={isOwnProfile}
			/>
		);
	}

	sections.push(
		<WorkHistorySection key="work-history" stints={employerStints} />
	);

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 800,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			{/* Profile Hero */}
			<div
				style={{
					display: "flex",
					gap: 24,
					alignItems: "flex-start",
					marginBottom: 32,
					backgroundColor: "#fff",
					padding: 24,
					borderRadius: "8px",
					border: "1px solid #f0f0f0",
				}}
			>
				{/* Avatar */}
				<div style={{ flexShrink: 0 }}>
					{profile.profile_picture_url ? (
						<img
							src={profile.profile_picture_url}
							alt={displayName}
							style={{
								width: 96,
								height: 96,
								borderRadius: "50%",
								objectFit: "cover",
							}}
						/>
					) : (
						<Avatar size={96} icon={<UserOutlined />} />
					)}
				</div>

				{/* Identity and Actions */}
				<div style={{ flex: 1, minWidth: 0 }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "flex-start",
							gap: 16,
							marginBottom: 8,
						}}
					>
						<div>
							<Title level={3} style={{ margin: 0, marginBottom: 4 }}>
								{displayName}
							</Title>
							<Text
								type="secondary"
								style={{ fontFamily: "monospace", fontSize: 14 }}
							>
								@{profile.handle}
							</Text>
						</div>

						{/* Action Area */}
						<div style={{ flexShrink: 0 }}>
							{isOwnProfile ? (
								<Link to="/settings/profile">
									<Button>{t("publicProfile.editProfile")}</Button>
								</Link>
							) : connectionState ? (
								<ProfileActionsPanel
									handle={handle || ""}
									displayName={displayName}
									connectionState={connectionState}
									onStateChange={setConnectionState}
								/>
							) : null}
						</div>
					</div>

					{/* Short Bio */}
					{profile.short_bio && (
						<Text
							type="secondary"
							style={{ display: "block", marginBottom: 8 }}
						>
							{profile.short_bio}
						</Text>
					)}

					{/* Location */}
					{locationText && (
						<Text type="secondary" style={{ display: "block" }}>
							{locationText}
						</Text>
					)}
				</div>
			</div>

			{/* Sections */}
			<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
				{sections}
			</div>
		</div>
	);
}
