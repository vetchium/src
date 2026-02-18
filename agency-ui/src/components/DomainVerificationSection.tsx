import {
	CheckCircleOutlined,
	ClockCircleOutlined,
	CopyOutlined,
	ExclamationCircleOutlined,
	GlobalOutlined,
	ReloadOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Button,
	Card,
	Divider,
	Form,
	Input,
	List,
	message,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	DOMAIN_MAX_LENGTH,
	DOMAIN_MIN_LENGTH,
} from "vetchium-specs/common/common";
import type {
	AgencyClaimDomainRequest,
	AgencyClaimDomainResponse,
	AgencyDomainVerificationStatus,
	AgencyGetDomainStatusRequest,
	AgencyListDomainStatusItem,
	AgencyListDomainStatusRequest,
	AgencyListDomainStatusResponse,
	AgencyVerifyDomainRequest,
	AgencyVerifyDomainResponse,
} from "vetchium-specs/agency-domains/agency-domains";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";

const { Text, Paragraph } = Typography;

interface ClaimFormValues {
	domain: string;
}

export function DomainVerificationSection() {
	const { t } = useTranslation("auth");
	const { sessionToken } = useAuth();
	const [form] = Form.useForm<ClaimFormValues>();
	const [loading, setLoading] = useState(false);
	const [domainsLoading, setDomainsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [domains, setDomains] = useState<AgencyListDomainStatusItem[]>([]);
	const [claimResult, setClaimResult] =
		useState<AgencyClaimDomainResponse | null>(null);
	const [verifyResult, setVerifyResult] =
		useState<AgencyVerifyDomainResponse | null>(null);
	const [actionDomain, setActionDomain] = useState<string | null>(null);

	const getStatusTag = (status: AgencyDomainVerificationStatus) => {
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

	const loadDomains = useCallback(async () => {
		setDomainsLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: AgencyListDomainStatusRequest = {};
			const response = await fetch(`${apiBaseUrl}/agency/list-domains`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 200) {
				const data: AgencyListDomainStatusResponse = await response.json();
				setDomains(data.items);
			} else if (response.status !== 401) {
				setError(t("domain.loadFailed"));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domain.loadFailed"));
		} finally {
			setDomainsLoading(false);
		}
	}, [sessionToken, t]);

	useEffect(() => {
		loadDomains();
	}, [loadDomains]);

	const handleClaimDomain = async (values: ClaimFormValues) => {
		setLoading(true);
		setError(null);
		setClaimResult(null);
		setVerifyResult(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: AgencyClaimDomainRequest = {
				domain: values.domain.toLowerCase(),
			};

			const response = await fetch(`${apiBaseUrl}/agency/claim-domain`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 201) {
				const data: AgencyClaimDomainResponse = await response.json();
				setClaimResult(data);
				form.resetFields();
				await loadDomains();
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
			setActionDomain(domain);
			setError(null);

			try {
				const apiBaseUrl = await getApiBaseUrl();
				const request: AgencyGetDomainStatusRequest = {
					domain: domain.toLowerCase(),
				};

				const response = await fetch(`${apiBaseUrl}/agency/get-domain-status`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(request),
				});

				if (response.status === 200) {
					await loadDomains();
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
				setActionDomain(null);
			}
		},
		[sessionToken, t, loadDomains]
	);

	const handleVerifyDomain = async (domain: string) => {
		setActionDomain(domain);
		setError(null);
		setVerifyResult(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: AgencyVerifyDomainRequest = {
				domain: domain.toLowerCase(),
			};

			const response = await fetch(`${apiBaseUrl}/agency/verify-domain`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 200) {
				const data: AgencyVerifyDomainResponse = await response.json();
				setVerifyResult(data);
				await loadDomains();
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
			setActionDomain(null);
		}
	};

	const clearError = () => setError(null);

	return (
		<Card title={t("domain.title")} style={{ marginTop: 24 }}>
			<Spin spinning={loading || domainsLoading}>
				{error && (
					<Alert
						type="error"
						description={error}
						closable={{ afterClose: clearError }}
						style={{ marginBottom: 16 }}
					/>
				)}

				{verifyResult?.message && (
					<Alert
						type={verifyResult.status === "VERIFIED" ? "success" : "info"}
						description={verifyResult.message}
						style={{ marginBottom: 16 }}
					/>
				)}

				{claimResult && (
					<Alert
						type="success"
						description={
							<div>
								<Text strong>{t("domain.instructions")}</Text>
								<Paragraph style={{ marginTop: 8 }}>
									{t("domain.instructionsText", {
										domain: claimResult.domain,
									})}
								</Paragraph>
								<div>
									<Text strong>{t("domain.recordHost")}: </Text>
									<Text code>_vetchium-verify.{claimResult.domain}</Text>
									<Button
										type="text"
										icon={<CopyOutlined />}
										onClick={() =>
											copyToClipboard(`_vetchium-verify.${claimResult.domain}`)
										}
									/>
								</div>
								<div>
									<Text strong>{t("domain.recordValue")}: </Text>
									<Text code>{claimResult.verification_token}</Text>
									<Button
										type="text"
										icon={<CopyOutlined />}
										onClick={() =>
											copyToClipboard(claimResult.verification_token)
										}
									/>
								</div>
							</div>
						}
						style={{ marginBottom: 16 }}
					/>
				)}

				{domains.length > 0 && (
					<>
						<List
							dataSource={domains}
							renderItem={(item) => (
								<List.Item
									actions={[
										<Button
											key="verify"
											type="primary"
											size="small"
											icon={<ReloadOutlined />}
											loading={actionDomain === item.domain}
											onClick={() => handleVerifyDomain(item.domain)}
										>
											{t("domain.verifyButton")}
										</Button>,
										<Button
											key="refresh"
											size="small"
											loading={actionDomain === item.domain}
											onClick={() => handleGetStatus(item.domain)}
										>
											{t("domain.refreshStatus")}
										</Button>,
									]}
								>
									<Space>
										<Text code>{item.domain}</Text>
										{getStatusTag(item.status)}
									</Space>
									{(item.status === "PENDING" || item.status === "FAILING") &&
										item.verification_token && (
											<div style={{ marginTop: 4 }}>
												<Text type="secondary" style={{ fontSize: 12 }}>
													{t("domain.recordHost")}:{" "}
													<Text code style={{ fontSize: 12 }}>
														_vetchium-verify.{item.domain}
													</Text>
													<Button
														type="text"
														size="small"
														icon={<CopyOutlined />}
														onClick={() =>
															copyToClipboard(`_vetchium-verify.${item.domain}`)
														}
													/>
												</Text>
												<br />
												<Text type="secondary" style={{ fontSize: 12 }}>
													{t("domain.recordValue")}:{" "}
													<Text code style={{ fontSize: 12 }}>
														{item.verification_token}
													</Text>
													<Button
														type="text"
														size="small"
														icon={<CopyOutlined />}
														onClick={() =>
															copyToClipboard(item.verification_token!)
														}
													/>
												</Text>
											</div>
										)}
								</List.Item>
							)}
						/>
						<Divider />
					</>
				)}

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
									form.getFieldsError().some(({ errors }) => errors.length > 0)
								}
							>
								{t("domain.claimButton")}
							</Button>
						)}
					</Form.Item>
				</Form>
			</Spin>
		</Card>
	);
}
