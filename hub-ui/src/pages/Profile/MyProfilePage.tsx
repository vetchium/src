import {
	ArrowLeftOutlined,
	DeleteOutlined,
	EditOutlined,
	EnvironmentOutlined,
	PlusOutlined,
	UploadOutlined,
	UserOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Avatar,
	Button,
	Card,
	Form,
	Input,
	Modal,
	Popconfirm,
	Radio,
	Select,
	Space,
	Spin,
	Table,
	Tag,
	Typography,
	message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { COUNTRIES } from "../../lib/countries";
import { formatDateTime } from "../../utils/dateFormat";
import type {
	HubProfileOwnerView,
	UpdateMyProfileRequest,
} from "vetchium-specs/hub/profile";
import type {
	AddWorkEmailRequest,
	AddWorkEmailResponse,
	ListMyWorkEmailsRequest,
	WorkEmailStintOwnerView,
	WorkEmailStintStatus,
} from "vetchium-specs/hub/work-emails";

const { Title, Text, Paragraph } = Typography;

interface DisplayNameRow {
	language_code: string;
	display_name: string;
	is_preferred: boolean;
}

interface IdentityDraft {
	displayNames: DisplayNameRow[];
	shortBio: string;
	city: string;
	countryCode: string;
}

const BASE_LANGUAGE_OPTIONS = [
	{ value: "en-US", label: "English (en-US)" },
	{ value: "de-DE", label: "Deutsch (de-DE)" },
	{ value: "ta-IN", label: "தமிழ் (ta-IN)" },
];

function getPreferredName(
	displayNames: DisplayNameRow[],
	fallback: string
): string {
	if (!displayNames || displayNames.length === 0) return fallback;
	const preferred = displayNames.find((dn) => dn.is_preferred);
	return preferred?.display_name ?? displayNames[0]?.display_name ?? fallback;
}

export function MyProfilePage() {
	const { t, i18n } = useTranslation("profile");
	const { t: tWE } = useTranslation("workEmails");
	const { sessionToken } = useAuth();

	// Server state
	const [profile, setProfile] = useState<HubProfileOwnerView | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	// Picture
	const [uploadingPicture, setUploadingPicture] = useState(false);
	const [removingPicture, setRemovingPicture] = useState(false);

	// Identity section (picture + names + short bio + location)
	const [identityDraft, setIdentityDraft] = useState<IdentityDraft | null>(
		null
	);
	const [identitySaving, setIdentitySaving] = useState(false);
	const [identityError, setIdentityError] = useState<string | null>(null);

	// About section (long bio)
	const [aboutDraft, setAboutDraft] = useState<string | null>(null);
	const [aboutSaving, setAboutSaving] = useState(false);
	const [aboutError, setAboutError] = useState<string | null>(null);

	// Work emails
	const [workEmails, setWorkEmails] = useState<WorkEmailStintOwnerView[]>([]);
	const [workEmailsLoading, setWorkEmailsLoading] = useState(false);
	const [addModalOpen, setAddModalOpen] = useState(false);
	const [addEmail, setAddEmail] = useState("");
	const [addLoading, setAddLoading] = useState(false);
	const [pendingStint, setPendingStint] = useState<{
		stintId: string;
		email: string;
	} | null>(null);
	const [verifyCode, setVerifyCode] = useState("");
	const [verifyLoading, setVerifyLoading] = useState(false);
	const [reverifyStint, setReverifyStint] =
		useState<WorkEmailStintOwnerView | null>(null);
	const [reverifyCode, setReverifyCode] = useState("");
	const [reverifyLoading, setReverifyLoading] = useState(false);

	// Language options for the identity draft (include any custom codes in the profile)
	const languageOptions = useMemo(() => {
		const options = [...BASE_LANGUAGE_OPTIONS];
		if (identityDraft) {
			for (const dn of identityDraft.displayNames) {
				if (
					dn.language_code &&
					!options.find((o) => o.value === dn.language_code)
				) {
					options.push({ value: dn.language_code, label: dn.language_code });
				}
			}
		}
		return options;
	}, [identityDraft]);

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

	const loadWorkEmails = useCallback(async () => {
		if (!sessionToken) return;
		setWorkEmailsLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: ListMyWorkEmailsRequest = { limit: 50 };
			const res = await fetch(`${apiBaseUrl}/hub/list-my-work-emails`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				const data = await res.json();
				setWorkEmails(data.work_emails);
			}
		} catch {
			// non-critical
		} finally {
			setWorkEmailsLoading(false);
		}
	}, [sessionToken]);

	useEffect(() => {
		loadWorkEmails();
	}, [loadWorkEmails]);

	// ── Identity section ────────────────────────────────────────────────────────

	const startEditIdentity = () => {
		if (!profile) return;
		setIdentityDraft({
			displayNames: profile.display_names.map((dn) => ({ ...dn })),
			shortBio: profile.short_bio ?? "",
			city: profile.city ?? "",
			countryCode: profile.resident_country_code ?? "",
		});
		setIdentityError(null);
	};

	const cancelIdentity = () => {
		setIdentityDraft(null);
		setIdentityError(null);
	};

	const saveIdentity = async () => {
		if (!identityDraft || !sessionToken) return;

		if (identityDraft.displayNames.length === 0) {
			setIdentityError(t("myProfile.displayNames.errors.atLeastOne"));
			return;
		}
		if (
			identityDraft.displayNames.filter((dn) => dn.is_preferred).length !== 1
		) {
			setIdentityError(t("myProfile.displayNames.errors.exactlyOnePreferred"));
			return;
		}
		const langCodes = identityDraft.displayNames.map((dn) => dn.language_code);
		if (new Set(langCodes).size !== langCodes.length) {
			setIdentityError(t("myProfile.displayNames.errors.duplicateLanguage"));
			return;
		}

		setIdentitySaving(true);
		setIdentityError(null);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: UpdateMyProfileRequest = {
				display_names: identityDraft.displayNames,
				short_bio: identityDraft.shortBio || undefined,
				city: identityDraft.city || undefined,
				resident_country_code: identityDraft.countryCode || undefined,
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
				setIdentityDraft(null);
				message.success(t("myProfile.success.saved"));
			} else {
				setIdentityError(t("myProfile.errors.saveFailed"));
			}
		} catch {
			setIdentityError(t("myProfile.errors.saveFailed"));
		} finally {
			setIdentitySaving(false);
		}
	};

	const updateDraftDN = (
		idx: number,
		field: keyof DisplayNameRow,
		value: string | boolean
	) => {
		setIdentityDraft((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				displayNames: prev.displayNames.map((dn, i) =>
					i === idx ? { ...dn, [field]: value } : dn
				),
			};
		});
	};

	const setDraftPreferred = (idx: number) => {
		setIdentityDraft((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				displayNames: prev.displayNames.map((dn, i) => ({
					...dn,
					is_preferred: i === idx,
				})),
			};
		});
	};

	const addDraftDN = () => {
		setIdentityDraft((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				displayNames: [
					...prev.displayNames,
					{ language_code: "", display_name: "", is_preferred: false },
				],
			};
		});
	};

	const removeDraftDN = (idx: number) => {
		setIdentityDraft((prev) => {
			if (!prev) return prev;
			const next = prev.displayNames.filter((_, i) => i !== idx);
			if (prev.displayNames[idx].is_preferred && next.length > 0) {
				next[0] = { ...next[0], is_preferred: true };
			}
			return { ...prev, displayNames: next };
		});
	};

	// ── About section ───────────────────────────────────────────────────────────

	const startEditAbout = () => {
		setAboutDraft(profile?.long_bio ?? "");
		setAboutError(null);
	};

	const cancelAbout = () => {
		setAboutDraft(null);
		setAboutError(null);
	};

	const saveAbout = async () => {
		if (aboutDraft === null || !sessionToken) return;
		setAboutSaving(true);
		setAboutError(null);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: UpdateMyProfileRequest = {
				long_bio: aboutDraft || undefined,
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
				setAboutDraft(null);
				message.success(t("myProfile.success.saved"));
			} else {
				setAboutError(t("myProfile.errors.saveFailed"));
			}
		} catch {
			setAboutError(t("myProfile.errors.saveFailed"));
		} finally {
			setAboutSaving(false);
		}
	};

	// ── Picture handlers ────────────────────────────────────────────────────────

	const handleUploadPicture = async (
		e: React.ChangeEvent<HTMLInputElement>
	) => {
		const file = e.target.files?.[0];
		if (!file) return;
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

	// ── Work email handlers ─────────────────────────────────────────────────────

	const handleAddWorkEmail = async () => {
		if (!sessionToken || !addEmail.trim()) return;
		setAddLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: AddWorkEmailRequest = { email_address: addEmail.trim() };
			const res = await fetch(`${apiBaseUrl}/hub/add-work-email`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 201) {
				const data: AddWorkEmailResponse = await res.json();
				message.success(tWE("success.added"));
				setPendingStint({ stintId: data.stint_id, email: addEmail.trim() });
				setAddEmail("");
			} else if (res.status === 422) {
				message.error(tWE("addModal.personalDomainError"));
			} else if (res.status === 409) {
				message.error(tWE("addModal.alreadyHeldError"));
			} else {
				message.error(tWE("errors.addFailed"));
			}
		} catch {
			message.error(tWE("errors.addFailed"));
		} finally {
			setAddLoading(false);
		}
	};

	const handleVerifyCode = async () => {
		if (!sessionToken || !pendingStint || !verifyCode.trim()) return;
		setVerifyLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/verify-work-email`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					stint_id: pendingStint.stintId,
					code: verifyCode.trim(),
				}),
			});
			if (res.status === 200) {
				message.success(tWE("success.verified"));
				setPendingStint(null);
				setVerifyCode("");
				setAddModalOpen(false);
				loadWorkEmails();
			} else if (res.status === 403) {
				message.error(tWE("verifyPage.wrongCodeError"));
			} else {
				message.error(tWE("errors.verifyFailed"));
			}
		} catch {
			message.error(tWE("errors.verifyFailed"));
		} finally {
			setVerifyLoading(false);
		}
	};

	const handleResendCode = async () => {
		if (!sessionToken || !pendingStint) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/resend-work-email-code`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ stint_id: pendingStint.stintId }),
			});
			if (res.status === 200) {
				message.success(tWE("success.resent"));
			} else {
				message.error(tWE("errors.resendFailed"));
			}
		} catch {
			message.error(tWE("errors.resendFailed"));
		}
	};

	const handleCancelAdd = async () => {
		if (pendingStint && sessionToken) {
			const apiBaseUrl = await getApiBaseUrl();
			await fetch(`${apiBaseUrl}/hub/remove-work-email`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ stint_id: pendingStint.stintId }),
			}).catch(() => {});
		}
		setPendingStint(null);
		setVerifyCode("");
		setAddEmail("");
		setAddModalOpen(false);
		loadWorkEmails();
	};

	const handleRemoveWorkEmail = async (stintId: string) => {
		if (!sessionToken) return;
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/remove-work-email`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ stint_id: stintId }),
			});
			if (res.status === 204) {
				message.success(tWE("success.removed"));
				loadWorkEmails();
			} else {
				message.error(tWE("errors.removeFailed"));
			}
		} catch {
			message.error(tWE("errors.removeFailed"));
		}
	};

	const handleReverify = async () => {
		if (!sessionToken || !reverifyStint || !reverifyCode.trim()) return;
		setReverifyLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}/hub/reverify-work-email`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					stint_id: reverifyStint.stint_id,
					code: reverifyCode.trim(),
				}),
			});
			if (res.status === 200) {
				message.success(tWE("success.reverified"));
				setReverifyStint(null);
				setReverifyCode("");
				loadWorkEmails();
			} else if (res.status === 403) {
				message.error(tWE("verifyPage.wrongCodeError"));
			} else {
				message.error(tWE("errors.reverifyFailed"));
			}
		} catch {
			message.error(tWE("errors.reverifyFailed"));
		} finally {
			setReverifyLoading(false);
		}
	};

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

	const preferredName = getPreferredName(
		profile?.display_names ?? [],
		profile?.handle ?? ""
	);
	const countryName = profile?.resident_country_code
		? (COUNTRIES.find((c) => c.code === profile.resident_country_code)?.name ??
			profile.resident_country_code)
		: null;

	const isAnyEditing = identityDraft !== null || aboutDraft !== null;

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 800,
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

			{loadError && (
				<Alert type="error" title={loadError} style={{ marginBottom: 16 }} />
			)}

			{/* ── Identity section ─────────────────────────────────────────────── */}
			<Card style={{ marginBottom: 16 }}>
				{identityDraft === null ? (
					// Read mode
					<div
						style={{
							display: "flex",
							gap: 20,
							alignItems: "flex-start",
							flexWrap: "wrap",
						}}
					>
						<div style={{ flexShrink: 0 }}>
							{profile?.has_profile_picture ? (
								<img
									src={`/hub/profile-picture/${profile.handle}`}
									alt="Profile"
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
						<div style={{ flex: 1, minWidth: 0 }}>
							<Title level={3} style={{ margin: 0, marginBottom: 2 }}>
								{preferredName}
							</Title>
							{profile?.short_bio ? (
								<Text
									style={{ fontSize: 15, display: "block", marginBottom: 4 }}
								>
									{profile.short_bio}
								</Text>
							) : (
								<Text
									type="secondary"
									style={{
										fontStyle: "italic",
										display: "block",
										marginBottom: 4,
									}}
								>
									{t("myProfile.identity.noShortBio")}
								</Text>
							)}
							<Text
								type="secondary"
								style={{ fontFamily: "monospace", fontSize: 13 }}
							>
								@{profile?.handle}
							</Text>
							{(profile?.city || countryName) && (
								<div style={{ marginTop: 4 }}>
									<EnvironmentOutlined
										style={{ marginRight: 6, color: "#8c8c8c" }}
									/>
									<Text type="secondary">
										{[profile?.city, countryName].filter(Boolean).join(", ")}
									</Text>
								</div>
							)}
						</div>
						<Button
							icon={<EditOutlined />}
							onClick={startEditIdentity}
							disabled={aboutDraft !== null}
						>
							{t("myProfile.edit")}
						</Button>
					</div>
				) : (
					// Edit mode
					<div>
						{/* Picture controls */}
						<div
							style={{
								display: "flex",
								gap: 16,
								alignItems: "center",
								marginBottom: 24,
								paddingBottom: 20,
								borderBottom: "1px solid #f0f0f0",
							}}
						>
							{profile?.has_profile_picture ? (
								<img
									src={`/hub/profile-picture/${profile.handle}`}
									alt="Profile"
									style={{
										width: 72,
										height: 72,
										borderRadius: "50%",
										objectFit: "cover",
										flexShrink: 0,
									}}
								/>
							) : (
								<Avatar
									size={72}
									icon={<UserOutlined />}
									style={{ flexShrink: 0 }}
								/>
							)}
							<Space wrap>
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
										cancelText={t("myProfile.cancelEdit")}
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
						</div>

						{/* Display names */}
						<Form layout="vertical">
							<Form.Item label={t("myProfile.displayNames.title")}>
								{identityDraft.displayNames.map((dn, idx) => (
									<div
										key={idx}
										style={{
											display: "flex",
											gap: 8,
											marginBottom: 8,
											flexWrap: "wrap",
											alignItems: "baseline",
										}}
									>
										<Select
											value={dn.language_code || undefined}
											onChange={(v) =>
												updateDraftDN(idx, "language_code", v ?? "")
											}
											options={languageOptions}
											placeholder={t("myProfile.displayNames.languageCode")}
											style={{ width: 200 }}
										/>
										<Input
											placeholder={t("myProfile.displayNames.displayName")}
											value={dn.display_name}
											onChange={(e) =>
												updateDraftDN(idx, "display_name", e.target.value)
											}
											style={{ width: 220 }}
										/>
										<Radio
											checked={dn.is_preferred}
											onChange={() => setDraftPreferred(idx)}
										>
											{t("myProfile.displayNames.isPreferred")}
										</Radio>
										<Button
											danger
											size="small"
											onClick={() => removeDraftDN(idx)}
											disabled={identityDraft.displayNames.length <= 1}
										>
											{t("myProfile.displayNames.remove")}
										</Button>
									</div>
								))}
								<Button
									icon={<PlusOutlined />}
									onClick={addDraftDN}
									disabled={identityDraft.displayNames.length >= 10}
									style={{ marginTop: 4 }}
								>
									{t("myProfile.displayNames.addLanguage")}
								</Button>
							</Form.Item>

							<Form.Item
								label={t("myProfile.bio.shortBio")}
								help={t("myProfile.bio.shortBioHelp")}
							>
								<Input
									value={identityDraft.shortBio}
									onChange={(e) =>
										setIdentityDraft((prev) =>
											prev ? { ...prev, shortBio: e.target.value } : prev
										)
									}
									maxLength={160}
									showCount
									placeholder={t("myProfile.identity.noShortBio")}
								/>
							</Form.Item>

							<Form.Item label={t("myProfile.location.country")}>
								<Select
									value={identityDraft.countryCode || undefined}
									onChange={(v) =>
										setIdentityDraft((prev) =>
											prev ? { ...prev, countryCode: v ?? "" } : prev
										)
									}
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
									value={identityDraft.city}
									onChange={(e) =>
										setIdentityDraft((prev) =>
											prev ? { ...prev, city: e.target.value } : prev
										)
									}
									maxLength={100}
									style={{ maxWidth: 400 }}
								/>
							</Form.Item>
						</Form>

						{identityError && (
							<Alert
								type="error"
								title={identityError}
								style={{ marginBottom: 12 }}
							/>
						)}
						<Space>
							<Button
								type="primary"
								loading={identitySaving}
								onClick={saveIdentity}
							>
								{t("myProfile.saveSection")}
							</Button>
							<Button onClick={cancelIdentity}>
								{t("myProfile.cancelEdit")}
							</Button>
						</Space>
					</div>
				)}
			</Card>

			{/* ── About section ────────────────────────────────────────────────── */}
			<Card
				title={t("myProfile.about.title")}
				style={{ marginBottom: 16 }}
				extra={
					aboutDraft === null && (
						<Button
							icon={<EditOutlined />}
							size="small"
							onClick={startEditAbout}
							disabled={identityDraft !== null}
						>
							{t("myProfile.edit")}
						</Button>
					)
				}
			>
				{aboutDraft === null ? (
					profile?.long_bio ? (
						<Paragraph style={{ whiteSpace: "pre-line", margin: 0 }}>
							{profile.long_bio}
						</Paragraph>
					) : (
						<Text
							type="secondary"
							style={{ fontStyle: "italic", cursor: "pointer" }}
							onClick={startEditAbout}
						>
							{t("myProfile.about.placeholder")}
						</Text>
					)
				) : (
					<div>
						<Input.TextArea
							value={aboutDraft}
							onChange={(e) => setAboutDraft(e.target.value)}
							maxLength={4000}
							showCount
							rows={8}
							placeholder={t("myProfile.about.placeholder")}
							style={{ marginBottom: 12 }}
						/>
						{aboutError && (
							<Alert
								type="error"
								title={aboutError}
								style={{ marginBottom: 12 }}
							/>
						)}
						<Space>
							<Button
								type="primary"
								loading={aboutSaving}
								onClick={saveAbout}
								disabled={isAnyEditing && identityDraft !== null}
							>
								{t("myProfile.saveSection")}
							</Button>
							<Button onClick={cancelAbout}>{t("myProfile.cancelEdit")}</Button>
						</Space>
					</div>
				)}
			</Card>

			{/* ── Work Emails section ───────────────────────────────────────────── */}
			<Card
				title={tWE("title")}
				extra={
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => setAddModalOpen(true)}
						size="small"
					>
						{tWE("addWorkEmail")}
					</Button>
				}
			>
				<Spin spinning={workEmailsLoading}>
					<Table
						dataSource={workEmails}
						rowKey="stint_id"
						pagination={false}
						locale={{ emptyText: tWE("emptyState") }}
						columns={[
							{
								title: tWE("table.emailAddress"),
								dataIndex: "email_address",
								key: "email_address",
							},
							{
								title: tWE("table.domain"),
								dataIndex: "domain",
								key: "domain",
							},
							{
								title: tWE("table.status"),
								dataIndex: "status",
								key: "status",
								render: (s: WorkEmailStintStatus) => {
									const colorMap: Record<WorkEmailStintStatus, string> = {
										active: "green",
										pending_verification: "orange",
										ended: "default",
									};
									const labelMap: Record<WorkEmailStintStatus, string> = {
										active: tWE("status.active"),
										pending_verification: tWE("status.pendingVerification"),
										ended: tWE("status.ended"),
									};
									return <Tag color={colorMap[s]}>{labelMap[s]}</Tag>;
								},
							},
							{
								title: tWE("table.verifiedSince"),
								dataIndex: "first_verified_at",
								key: "first_verified_at",
								render: (v?: string) =>
									v ? formatDateTime(v, i18n.language) : "—",
							},
							{
								title: tWE("table.actions"),
								key: "actions",
								render: (_: unknown, r: WorkEmailStintOwnerView) => (
									<Space>
										{r.status === "pending_verification" && (
											<Button
												size="small"
												onClick={() => {
													setPendingStint({
														stintId: r.stint_id,
														email: r.email_address,
													});
													setAddModalOpen(true);
												}}
											>
												{tWE("table.enterCode")}
											</Button>
										)}
										{r.status === "active" &&
											r.reverify_challenge_issued_at && (
												<Button
													size="small"
													onClick={() => setReverifyStint(r)}
												>
													{tWE("table.reverify")}
												</Button>
											)}
										<Popconfirm
											title={tWE("removeConfirm")}
											onConfirm={() => handleRemoveWorkEmail(r.stint_id)}
											okText={tWE("table.remove")}
											cancelText={t("myProfile.cancelEdit")}
										>
											<Button size="small" danger>
												{tWE("table.remove")}
											</Button>
										</Popconfirm>
									</Space>
								),
							},
						]}
					/>
				</Spin>
			</Card>

			{/* Add / Verify work email modal */}
			<Modal
				open={addModalOpen}
				title={pendingStint ? tWE("verifyPage.title") : tWE("addModal.title")}
				onCancel={handleCancelAdd}
				footer={null}
				destroyOnHide
			>
				{!pendingStint ? (
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						<Input
							type="email"
							placeholder={tWE("addModal.emailLabel")}
							value={addEmail}
							onChange={(e) => setAddEmail(e.target.value)}
							onPressEnter={handleAddWorkEmail}
						/>
						<Button
							type="primary"
							block
							loading={addLoading}
							onClick={handleAddWorkEmail}
							disabled={!addEmail.trim()}
						>
							{tWE("addModal.submit")}
						</Button>
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						<p>{tWE("verifyPage.subtitle", { email: pendingStint.email })}</p>
						<Input
							placeholder="000000"
							maxLength={6}
							value={verifyCode}
							onChange={(e) => setVerifyCode(e.target.value)}
							onPressEnter={handleVerifyCode}
						/>
						<Button
							type="primary"
							block
							loading={verifyLoading}
							onClick={handleVerifyCode}
							disabled={verifyCode.trim().length !== 6}
						>
							{tWE("verifyPage.submit")}
						</Button>
						<Button block onClick={handleResendCode}>
							{tWE("verifyPage.resend")}
						</Button>
						<Button block danger onClick={handleCancelAdd}>
							{tWE("verifyPage.cancel")}
						</Button>
					</div>
				)}
			</Modal>

			{/* Re-verify work email modal */}
			<Modal
				open={!!reverifyStint}
				title={tWE("detail.reverifyModal.title")}
				onCancel={() => {
					setReverifyStint(null);
					setReverifyCode("");
				}}
				footer={null}
				destroyOnHide
			>
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<Input
						placeholder="000000"
						maxLength={6}
						value={reverifyCode}
						onChange={(e) => setReverifyCode(e.target.value)}
						onPressEnter={handleReverify}
					/>
					<Button
						type="primary"
						block
						loading={reverifyLoading}
						onClick={handleReverify}
						disabled={reverifyCode.trim().length !== 6}
					>
						{tWE("detail.reverifyModal.submit")}
					</Button>
				</div>
			</Modal>
		</div>
	);
}
