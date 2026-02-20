import {
	ArrowLeftOutlined,
	CheckCircleOutlined,
	ClockCircleOutlined,
	CopyOutlined,
	ExclamationCircleOutlined,
	GlobalOutlined,
	SyncOutlined,
} from "@ant-design/icons";
import {
	Alert,
	App,
	Button,
	Card,
	Form,
	Input,
	Modal,
	Space,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	ClaimDomainRequest,
	ClaimDomainResponse,
	ListDomainStatusItem,
	ListDomainStatusRequest,
	ListDomainStatusResponse,
	VerifyDomainRequest,
	VerifyDomainResponse,
} from "vetchium-specs/employer-domains/employer-domains";
import { DomainVerificationStatus } from "vetchium-specs/employer-domains/employer-domains";
import {
	DOMAIN_MAX_LENGTH,
	DOMAIN_MIN_LENGTH,
} from "vetchium-specs/common/common";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Text, Paragraph, Title } = Typography;

interface ClaimFormValues {
	domain: string;
}

export function DomainManagementPage() {
	const { t } = useTranslation("auth");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const [form] = Form.useForm<ClaimFormValues>();

	const [domains, setDomains] = useState<ListDomainStatusItem[]>([]);
	const [domainsLoading, setDomainsLoading] = useState(false);
	const [claimLoading, setClaimLoading] = useState(false);
	const [actionDomain, setActionDomain] = useState<string | null>(null);
	const [claimResult, setClaimResult] = useState<ClaimDomainResponse | null>(
		null
	);
	const [error, setError] = useState<string | null>(null);
	// The domain whose DNS instructions modal is currently open
	const [instructionsDomain, setInstructionsDomain] =
		useState<ListDomainStatusItem | null>(null);

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
			const request: ListDomainStatusRequest = {};
			const response = await fetch(`${apiBaseUrl}/employer/list-domains`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 200) {
				const data: ListDomainStatusResponse = await response.json();
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
		setClaimLoading(true);
		setError(null);
		setClaimResult(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: ClaimDomainRequest = {
				domain: values.domain.toLowerCase(),
			};

			const response = await fetch(`${apiBaseUrl}/employer/claim-domain`, {
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
			setClaimLoading(false);
		}
	};

	const handleRequestVerification = async (domain: string) => {
		setActionDomain(domain);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: VerifyDomainRequest = {
				domain: domain.toLowerCase(),
			};

			const response = await fetch(`${apiBaseUrl}/employer/verify-domain`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 200) {
				const data: VerifyDomainResponse = await response.json();
				if (data.status === DomainVerificationStatus.VERIFIED) {
					message.success(t("domain.verifiedSuccess"));
					setInstructionsDomain(null);
				} else {
					message.info(data.message ?? t("domain.verificationPending"));
				}
				await loadDomains();
				return;
			}

			if (response.status === 429) {
				setError(t("domain.rateLimited"));
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

	const formatLocalTime = (isoString: string) =>
		new Date(isoString).toLocaleString(navigator.language);

	const columns = [
		{
			title: t("domain.yourDomain"),
			dataIndex: "domain",
			key: "domain",
			render: (domain: string) => (
				<Tag icon={<GlobalOutlined />}>{domain}</Tag>
			),
		},
		{
			title: t("domain.statusLabel"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => {
				switch (status) {
					case DomainVerificationStatus.VERIFIED:
						return (
							<Tag icon={<CheckCircleOutlined />} color="success">
								{t("domain.statusVerified")}
							</Tag>
						);
					case DomainVerificationStatus.PENDING:
						return (
							<Tag icon={<ClockCircleOutlined />} color="processing">
								{t("domain.statusPending")}
							</Tag>
						);
					case DomainVerificationStatus.FAILING:
						return (
							<Tag icon={<ExclamationCircleOutlined />} color="warning">
								{t("domain.statusFailing")}
							</Tag>
						);
					default:
						return <Tag>{status}</Tag>;
				}
			},
		},
		{
			title: t("domain.infoLabel"),
			key: "info",
			render: (_: unknown, record: ListDomainStatusItem) => {
				if (record.status === DomainVerificationStatus.VERIFIED) {
					return (
						<Space orientation="vertical" size={4}>
							{record.last_verified_at && (
								<Text type="secondary" style={{ fontSize: 12 }}>
									{t("domain.lastVerified")}:{" "}
									{formatLocalTime(record.last_verified_at)}
								</Text>
							)}
							{record.can_request_verification && (
								<Button
									size="small"
									icon={<SyncOutlined />}
									loading={actionDomain === record.domain}
									onClick={() => handleRequestVerification(record.domain)}
								>
									{t("domain.requestReVerification")}
								</Button>
							)}
						</Space>
					);
				}
				// PENDING or FAILING
				return (
					<Space orientation="vertical" size={4}>
						{record.expires_at && (
							<Text type="secondary" style={{ fontSize: 12 }}>
								{t("domain.tokenExpires")}:{" "}
								{formatLocalTime(record.expires_at)}
							</Text>
						)}
						<Button
							size="small"
							onClick={() => setInstructionsDomain(record)}
						>
							{t("domain.showDnsInstructions")}
						</Button>
					</Space>
				);
			},
		},
	];

	return (
		<div
			style={{
				maxWidth: 900,
				width: "100%",
				padding: "24px 16px",
			}}
		>
			<Space style={{ marginBottom: 24 }}>
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>
						{t("domain.backToDashboard")}
					</Button>
				</Link>
			</Space>

			<Title level={3} style={{ marginBottom: 24 }}>
				{t("domainManagement.title")}
			</Title>

			{error && (
				<Alert
					type="error"
					description={error}
					closable={{ afterClose: () => setError(null) }}
					style={{ marginBottom: 16 }}
				/>
			)}

			{claimResult && (
				<Alert
					type="success"
					style={{ marginBottom: 16 }}
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
				/>
			)}

			<Spin spinning={domainsLoading}>
				<Table
					dataSource={domains}
					columns={columns}
					rowKey="domain"
					pagination={false}
					style={{ marginBottom: 32 }}
				/>
			</Spin>

			{/* DNS instructions modal — title always names the domain so ownership is unambiguous */}
			<Modal
				open={!!instructionsDomain}
				onCancel={() => setInstructionsDomain(null)}
				footer={null}
				title={
					instructionsDomain ? (
						<Space>
							{t("domain.dnsRecordInstructions")}
							<Tag icon={<GlobalOutlined />}>{instructionsDomain.domain}</Tag>
						</Space>
					) : ""
				}
				width={600}
			>
				{instructionsDomain && (
					<Space orientation="vertical" size={12} style={{ width: "100%" }}>
						<Paragraph type="secondary" style={{ marginBottom: 0 }}>
							{t("domain.instructionsText", {
								domain: instructionsDomain.domain,
							})}
						</Paragraph>

						<div>
							<Text strong>{t("domain.recordHost")}: </Text>
							<Text code>
								_vetchium-verify.{instructionsDomain.domain}
							</Text>
							<Button
								type="text"
								size="small"
								icon={<CopyOutlined />}
								onClick={() =>
									copyToClipboard(
										`_vetchium-verify.${instructionsDomain.domain}`
									)
								}
							/>
						</div>

						<div>
							<Text strong>{t("domain.recordValue")}: </Text>
							<Text code>{instructionsDomain.verification_token}</Text>
							<Button
								type="text"
								size="small"
								icon={<CopyOutlined />}
								onClick={() =>
									copyToClipboard(instructionsDomain.verification_token!)
								}
							/>
						</div>

						{instructionsDomain.last_attempted_at && (
							<Text type="secondary" style={{ fontSize: 12 }}>
								{t("domain.lastAttempted")}:{" "}
								{formatLocalTime(instructionsDomain.last_attempted_at)}
							</Text>
						)}

						{!instructionsDomain.can_request_verification &&
							instructionsDomain.next_verification_allowed_at && (
								<Text type="secondary" style={{ fontSize: 12 }}>
									{t("domain.nextRetryAllowed")}:{" "}
									{formatLocalTime(
										instructionsDomain.next_verification_allowed_at
									)}
								</Text>
							)}

						{instructionsDomain.can_request_verification && (
							<Button
								type="primary"
								icon={<SyncOutlined />}
								loading={actionDomain === instructionsDomain.domain}
								onClick={() =>
									handleRequestVerification(instructionsDomain.domain)
								}
							>
								{t("domain.requestVerification")}
							</Button>
						)}
					</Space>
				)}
			</Modal>

			<Card title={t("domain.claimLabel")}>
				<Spin spinning={claimLoading}>
					<Form
						form={form}
						name="claimDomain"
						onFinish={handleClaimDomain}
						layout="vertical"
						requiredMark={false}
					>
						<Form.Item
							name="domain"
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
				</Spin>
			</Card>
		</div>
	);
}
