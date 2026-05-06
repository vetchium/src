import {
	ArrowLeftOutlined,
	DeleteOutlined,
	PlusOutlined,
	UploadOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Button,
	Card,
	Form,
	Input,
	Popconfirm,
	Radio,
	Select,
	Space,
	Spin,
	Typography,
	message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { COUNTRIES } from "../../lib/countries";
import type {
	HubProfileOwnerView,
	UpdateMyProfileRequest,
} from "vetchium-specs/hub/profile";

const { Title, Text } = Typography;

interface DisplayNameRow {
	language_code: string;
	display_name: string;
	is_preferred: boolean;
}

export function MyProfilePage() {
	const { t } = useTranslation("profile");
	const { sessionToken } = useAuth();

	const [profile, setProfile] = useState<HubProfileOwnerView | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [uploadingPicture, setUploadingPicture] = useState(false);
	const [removingPicture, setRemovingPicture] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);

	const [displayNames, setDisplayNames] = useState<DisplayNameRow[]>([]);
	const [shortBio, setShortBio] = useState("");
	const [longBio, setLongBio] = useState("");
	const [city, setCity] = useState("");
	const [countryCode, setCountryCode] = useState<string>("");

	const loadProfile = useCallback(async () => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/get-my-profile`, {
				method: "GET",
				headers: { Authorization: `Bearer ${sessionToken}` },
			});
			if (response.status === 200) {
				const data: HubProfileOwnerView = await response.json();
				setProfile(data);
				setDisplayNames(
					data.display_names.map((dn) => ({
						language_code: dn.language_code,
						display_name: dn.display_name,
						is_preferred: dn.is_preferred,
					}))
				);
				setShortBio(data.short_bio ?? "");
				setLongBio(data.long_bio ?? "");
				setCity(data.city ?? "");
				setCountryCode(data.resident_country_code ?? "");
				setLoadError(null);
			} else {
				setLoadError(t("myProfile.errors.loadFailed"));
			}
		} catch {
			setLoadError(t("myProfile.errors.loadFailed"));
		}
	}, [sessionToken, t]);

	useEffect(() => {
		const run = async () => {
			await loadProfile();
			setLoading(false);
		};
		run();
	}, [loadProfile]);

	const handleSave = async () => {
		// Validate display names
		if (displayNames.length === 0) {
			setSaveError(t("myProfile.displayNames.errors.atLeastOne"));
			return;
		}
		const preferredCount = displayNames.filter((dn) => dn.is_preferred).length;
		if (preferredCount !== 1) {
			setSaveError(t("myProfile.displayNames.errors.exactlyOnePreferred"));
			return;
		}
		const langCodes = displayNames.map((dn) => dn.language_code);
		const uniqueLangCodes = new Set(langCodes);
		if (uniqueLangCodes.size !== langCodes.length) {
			setSaveError(t("myProfile.displayNames.errors.duplicateLanguage"));
			return;
		}

		setSaving(true);
		setSaveError(null);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: UpdateMyProfileRequest = {
				display_names: displayNames.map((dn) => ({
					language_code: dn.language_code,
					display_name: dn.display_name,
					is_preferred: dn.is_preferred,
				})),
				short_bio: shortBio || undefined,
				long_bio: longBio || undefined,
				city: city || undefined,
				resident_country_code: countryCode || undefined,
			};
			const response = await fetch(`${apiBaseUrl}/hub/update-my-profile`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (response.status === 200) {
				const data: HubProfileOwnerView = await response.json();
				setProfile(data);
				message.success(t("myProfile.success.saved"));
			} else {
				setSaveError(t("myProfile.errors.saveFailed"));
			}
		} catch {
			setSaveError(t("myProfile.errors.saveFailed"));
		} finally {
			setSaving(false);
		}
	};

	const handleUploadPicture = async (
		e: React.ChangeEvent<HTMLInputElement>
	) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// Client-side validation
		const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
		if (!allowedTypes.includes(file.type)) {
			message.error(t("myProfile.picture.errors.wrongFormat"));
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			message.error(t("myProfile.picture.errors.tooLarge"));
			return;
		}

		setUploadingPicture(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const formData = new FormData();
			formData.append("image", file);
			const response = await fetch(`${apiBaseUrl}/hub/upload-profile-picture`, {
				method: "POST",
				headers: { Authorization: `Bearer ${sessionToken}` },
				body: formData,
			});
			if (response.status === 200) {
				const data: HubProfileOwnerView = await response.json();
				setProfile(data);
				message.success(t("myProfile.success.pictureUploaded"));
			} else {
				message.error(t("myProfile.errors.pictureFailed"));
			}
		} catch {
			message.error(t("myProfile.errors.pictureFailed"));
		} finally {
			setUploadingPicture(false);
			// Reset the file input
			e.target.value = "";
		}
	};

	const handleRemovePicture = async () => {
		setRemovingPicture(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/remove-profile-picture`, {
				method: "POST",
				headers: { Authorization: `Bearer ${sessionToken}` },
			});
			if (response.status === 200) {
				const data: HubProfileOwnerView = await response.json();
				setProfile(data);
				message.success(t("myProfile.success.pictureRemoved"));
			} else {
				message.error(t("myProfile.errors.pictureFailed"));
			}
		} catch {
			message.error(t("myProfile.errors.pictureFailed"));
		} finally {
			setRemovingPicture(false);
		}
	};

	const addDisplayNameRow = () => {
		setDisplayNames((prev) => [
			...prev,
			{ language_code: "", display_name: "", is_preferred: prev.length === 0 },
		]);
	};

	const removeDisplayNameRow = (idx: number) => {
		setDisplayNames((prev) => {
			const next = prev.filter((_, i) => i !== idx);
			// If we removed the preferred one, set first as preferred
			if (prev[idx].is_preferred && next.length > 0) {
				next[0] = { ...next[0], is_preferred: true };
			}
			return next;
		});
	};

	const setPreferred = (idx: number) => {
		setDisplayNames((prev) =>
			prev.map((dn, i) => ({ ...dn, is_preferred: i === idx }))
		);
	};

	const updateDisplayName = (
		idx: number,
		field: keyof DisplayNameRow,
		value: string | boolean
	) => {
		setDisplayNames((prev) =>
			prev.map((dn, i) => (i === idx ? { ...dn, [field]: value } : dn))
		);
	};

	if (loading) {
		return (
			<div
				style={{
					width: "100%",
					maxWidth: 1200,
					padding: "24px 16px",
					alignSelf: "flex-start",
				}}
			>
				<Spin spinning />
			</div>
		);
	}

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
					<Button icon={<ArrowLeftOutlined />}>
						{t("myProfile.backToSettings")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("myProfile.title")}
			</Title>

			{loadError && (
				<Alert type="error" title={loadError} style={{ marginBottom: 16 }} />
			)}
			{saveError && (
				<Alert type="error" title={saveError} style={{ marginBottom: 16 }} />
			)}

			{/* Profile picture */}
			<Card title={t("myProfile.picture.title")} style={{ marginBottom: 24 }}>
				<Space align="center" style={{ flexWrap: "wrap" }}>
					{profile?.has_profile_picture && (
						<img
							src={`/hub/profile-picture/${profile?.handle}`}
							alt="Profile"
							style={{
								width: 96,
								height: 96,
								borderRadius: "50%",
								objectFit: "cover",
							}}
						/>
					)}
					<Space>
						<label>
							<Button
								icon={<UploadOutlined />}
								loading={uploadingPicture}
								onClick={() =>
									document.getElementById("profile-picture-input")?.click()
								}
							>
								{t("myProfile.picture.upload")}
							</Button>
							<input
								id="profile-picture-input"
								type="file"
								accept="image/jpeg,image/png,image/webp"
								style={{ display: "none" }}
								onChange={handleUploadPicture}
							/>
						</label>
						{profile?.has_profile_picture && (
							<Popconfirm
								title={t("myProfile.picture.removeConfirm")}
								onConfirm={handleRemovePicture}
								okText={t("myProfile.picture.remove")}
								cancelText={t("myProfile.displayNames.remove")}
							>
								<Button
									danger
									icon={<DeleteOutlined />}
									loading={removingPicture}
								>
									{t("myProfile.picture.remove")}
								</Button>
							</Popconfirm>
						)}
					</Space>
				</Space>
			</Card>

			{/* Display names */}
			<Card
				title={t("myProfile.displayNames.title")}
				style={{ marginBottom: 24 }}
			>
				{displayNames.map((dn, idx) => (
					<Space
						key={idx}
						style={{ display: "flex", marginBottom: 8, flexWrap: "wrap" }}
						align="baseline"
					>
						<Input
							placeholder={t("myProfile.displayNames.languageCode")}
							value={dn.language_code}
							onChange={(e) =>
								updateDisplayName(idx, "language_code", e.target.value)
							}
							style={{ width: 120 }}
						/>
						<Input
							placeholder={t("myProfile.displayNames.displayName")}
							value={dn.display_name}
							onChange={(e) =>
								updateDisplayName(idx, "display_name", e.target.value)
							}
							style={{ width: 200 }}
						/>
						<Radio checked={dn.is_preferred} onChange={() => setPreferred(idx)}>
							{t("myProfile.displayNames.isPreferred")}
						</Radio>
						<Button
							danger
							size="small"
							onClick={() => removeDisplayNameRow(idx)}
							disabled={displayNames.length <= 1}
						>
							{t("myProfile.displayNames.remove")}
						</Button>
					</Space>
				))}
				<Button
					icon={<PlusOutlined />}
					onClick={addDisplayNameRow}
					style={{ marginTop: 8 }}
					disabled={displayNames.length >= 10}
				>
					{t("myProfile.displayNames.addLanguage")}
				</Button>
			</Card>

			{/* Bio */}
			<Card title={t("myProfile.bio.title")} style={{ marginBottom: 24 }}>
				<Form layout="vertical">
					<Form.Item
						label={
							<span>
								{t("myProfile.bio.shortBio")}{" "}
								<Text type="secondary">({shortBio.length}/160)</Text>
							</span>
						}
						help={t("myProfile.bio.shortBioHelp")}
					>
						<Input
							value={shortBio}
							onChange={(e) => setShortBio(e.target.value)}
							maxLength={160}
							showCount
						/>
					</Form.Item>
					<Form.Item
						label={
							<span>
								{t("myProfile.bio.longBio")}{" "}
								<Text type="secondary">({longBio.length}/4000)</Text>
							</span>
						}
						help={t("myProfile.bio.longBioHelp")}
					>
						<Input.TextArea
							value={longBio}
							onChange={(e) => setLongBio(e.target.value)}
							maxLength={4000}
							showCount
							rows={6}
						/>
					</Form.Item>
				</Form>
			</Card>

			{/* Location */}
			<Card title={t("myProfile.location.title")} style={{ marginBottom: 24 }}>
				<Form layout="vertical">
					<Form.Item label={t("myProfile.location.country")}>
						<Select
							value={countryCode || undefined}
							onChange={(val) => setCountryCode(val ?? "")}
							allowClear
							showSearch={{
								filterOption: (input, option) =>
									(option?.label ?? "")
										.toLowerCase()
										.includes(input.toLowerCase()),
							}}
							options={COUNTRIES.map((c) => ({
								label: c.name,
								value: c.code,
							}))}
							placeholder={t("myProfile.location.country")}
							style={{ width: "100%", maxWidth: 400 }}
						/>
					</Form.Item>
					<Form.Item label={t("myProfile.location.city")}>
						<Input
							value={city}
							onChange={(e) => setCity(e.target.value)}
							maxLength={100}
							style={{ maxWidth: 400 }}
						/>
					</Form.Item>
				</Form>
			</Card>

			<Spin spinning={saving}>
				<Button
					type="primary"
					size="large"
					onClick={handleSave}
					loading={saving}
				>
					{t("myProfile.saveProfile")}
				</Button>
			</Spin>
		</div>
	);
}
