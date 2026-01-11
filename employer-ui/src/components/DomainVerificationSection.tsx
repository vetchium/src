import {
	Card,
	Form,
	Input,
	Button,
	Alert,
	Spin,
	Typography,
	Tag,
	Space,
	Divider,
	message,
} from "antd";
import {
	GlobalOutlined,
	CheckCircleOutlined,
	ClockCircleOutlined,
	ExclamationCircleOutlined,
	CopyOutlined,
	ReloadOutlined,
} from "@ant-design/icons";
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";
import {
	DOMAIN_MIN_LENGTH,
	DOMAIN_MAX_LENGTH,
} from "vetchium-specs/common/common";
import type {
	ClaimDomainRequest,
	ClaimDomainResponse,
	VerifyDomainRequest,
	VerifyDomainResponse,
	GetDomainStatusRequest,
	GetDomainStatusResponse,
	DomainVerificationStatus,
} from "vetchium-specs/orgdomains/orgdomains";

const { Text, Paragraph } = Typography;

interface ClaimFormValues {
	domain: string;
}

export function DomainVerificationSection() {
	const { t } = useTranslation("auth");
	const { sessionToken } = useAuth();
	const [form] = Form.useForm<ClaimFormValues>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [claimResult, setClaimResult] = useState<ClaimDomainResponse | null>(
		null
	);
	const [domainStatus, setDomainStatus] =
		useState<GetDomainStatusResponse | null>(null);
	const [verifyResult, setVerifyResult] = useState<VerifyDomainResponse | null>(
		null
	);

	const getStatusTag = (status: DomainVerificationStatus) => {
		switch (status) {
			case "VERIFIED":
				return (
					<Tag icon={<CheckCircleOutlined />} color="success">
						{t("domain.statusVerified")}
					</Tag>
				);
			case "PENDING":
				return (
					<Tag icon={<ClockCircleOutlined />} color="processing">
						{t("domain.statusPending")}
					</Tag>
				);
			case "FAILING":
				return (
					<Tag icon={<ExclamationCircleOutlined />} color="warning">
						{t("domain.statusFailing")}
					</Tag>
				);
			default:
				return <Tag>{status}</Tag>;
		}
	};

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			message.success(t("domain.copied"));
		} catch {
			message.error(t("domain.copyFailed"));
		}
	};

	const handleClaimDomain = async (values: ClaimFormValues) => {
		setLoading(true);
		setError(null);
		setClaimResult(null);
		setDomainStatus(null);
		setVerifyResult(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: ClaimDomainRequest = {
				domain: values.domain.toLowerCase(),
			};

			const response = await fetch(`${apiBaseUrl}/org/claim-domain`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 201) {
				const data: ClaimDomainResponse = await response.json();
				setClaimResult(data);
				form.resetFields();
				return;
			}

			if (response.status === 400) {
				const errors = await response.json();
				if (Array.isArray(errors)) {
					const errorMessages = errors
						.map(
							(e: { field: string; message: string }) =>
								`${e.field}: ${e.message}`
						)
						.join(", ");
					setError(errorMessages);
				} else {
					setError(t("errors.invalidRequest"));
				}
				return;
			}

			if (response.status === 401) {
				setError(t("domain.sessionExpired"));
				return;
			}

			if (response.status === 409) {
				setError(t("domain.alreadyClaimed"));
				return;
			}

			setError(t("domain.claimFailed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domain.claimFailed"));
		} finally {
			setLoading(false);
		}
	};

	const handleGetStatus = useCallback(
		async (domain: string) => {
			setLoading(true);
			setError(null);
			setVerifyResult(null);

			try {
				const apiBaseUrl = await getApiBaseUrl();
				const request: GetDomainStatusRequest = {
					domain: domain.toLowerCase(),
				};

				const response = await fetch(`${apiBaseUrl}/org/get-domain-status`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(request),
				});

				if (response.status === 200) {
					const data: GetDomainStatusResponse = await response.json();
					setDomainStatus(data);
					setClaimResult(null);
					return;
				}

				if (response.status === 404) {
					setError(t("domain.notFound"));
					return;
				}

				setError(t("domain.statusFailed"));
			} catch (err) {
				setError(err instanceof Error ? err.message : t("domain.statusFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, t]
	);

	const handleVerifyDomain = async (domain: string) => {
		setLoading(true);
		setError(null);
		setVerifyResult(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: VerifyDomainRequest = {
				domain: domain.toLowerCase(),
			};

			const response = await fetch(`${apiBaseUrl}/org/verify-domain`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 200) {
				const data: VerifyDomainResponse = await response.json();
				setVerifyResult(data);
				// Refresh status after verification
				await handleGetStatus(domain);
				return;
			}

			if (response.status === 404) {
				setError(t("domain.notFound"));
				return;
			}

			setError(t("domain.verifyFailed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domain.verifyFailed"));
		} finally {
			setLoading(false);
		}
	};

	const clearError = () => setError(null);

	const currentDomain = claimResult?.domain || domainStatus?.domain;
	const currentToken =
		claimResult?.verification_token || domainStatus?.verification_token;
	const currentStatus = domainStatus?.status;

	return (
		<Card title={t("domain.title")} style={{ marginTop: 24 }}>
			<Spin spinning={loading}>
				{error && (
					<Alert
						type="error"
						title={error}
						closable={{ afterClose: clearError }}
						style={{ marginBottom: 16 }}
					/>
				)}

				{verifyResult?.message && (
					<Alert
						type={verifyResult.status === "VERIFIED" ? "success" : "info"}
						title={verifyResult.message}
						style={{ marginBottom: 16 }}
					/>
				)}

				{!currentDomain && (
					<Form
						form={form}
						name="claimDomain"
						onFinish={handleClaimDomain}
						layout="vertical"
						requiredMark={false}
					>
						<Form.Item
							name="domain"
							label={t("domain.claimLabel")}
							rules={[
								{ required: true, message: t("domain.domainRequired") },
								{
									min: DOMAIN_MIN_LENGTH,
									message: t("domain.domainMinLength", {
										min: DOMAIN_MIN_LENGTH,
									}),
								},
								{
									max: DOMAIN_MAX_LENGTH,
									message: t("domain.domainMaxLength", {
										max: DOMAIN_MAX_LENGTH,
									}),
								},
								{
									pattern:
										/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
									message: t("domain.domainInvalid"),
								},
							]}
						>
							<Input
								prefix={<GlobalOutlined />}
								placeholder={t("domain.domainPlaceholder")}
								size="large"
							/>
						</Form.Item>

						<Form.Item shouldUpdate>
							{() => (
								<Button
									type="primary"
									htmlType="submit"
									size="large"
									block
									disabled={
										!form.isFieldsTouched(true) ||
										form
											.getFieldsError()
											.some(({ errors }) => errors.length > 0)
									}
								>
									{t("domain.claimButton")}
								</Button>
							)}
						</Form.Item>
					</Form>
				)}

				{currentDomain && (
					<div>
						<Space orientation="vertical" style={{ width: "100%" }}>
							<div>
								<Text strong>{t("domain.yourDomain")}: </Text>
								<Text code>{currentDomain}</Text>
								{currentStatus && <> {getStatusTag(currentStatus)}</>}
							</div>

							{currentToken && (
								<>
									<Divider />
									<Text strong>{t("domain.instructions")}</Text>
									<Paragraph>
										{t("domain.instructionsText", { domain: currentDomain })}
									</Paragraph>
									<div>
										<Text strong>{t("domain.recordHost")}: </Text>
										<Text code>_vetchium-verify.{currentDomain}</Text>
										<Button
											type="text"
											icon={<CopyOutlined />}
											onClick={() =>
												copyToClipboard(`_vetchium-verify.${currentDomain}`)
											}
										/>
									</div>
									<div>
										<Text strong>{t("domain.recordValue")}: </Text>
										<Text code>{currentToken}</Text>
										<Button
											type="text"
											icon={<CopyOutlined />}
											onClick={() => copyToClipboard(currentToken)}
										/>
									</div>
								</>
							)}

							<Divider />
							<Space>
								<Button
									type="primary"
									icon={<ReloadOutlined />}
									onClick={() => handleVerifyDomain(currentDomain)}
								>
									{t("domain.verifyButton")}
								</Button>
								<Button onClick={() => handleGetStatus(currentDomain)}>
									{t("domain.refreshStatus")}
								</Button>
							</Space>
						</Space>
					</div>
				)}
			</Spin>
		</Card>
	);
}
