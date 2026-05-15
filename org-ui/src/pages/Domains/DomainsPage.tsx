import {
	ArrowLeftOutlined,
	CheckCircleOutlined,
	ClockCircleOutlined,
	CopyOutlined,
	DeleteOutlined,
	ExclamationCircleOutlined,
	GlobalOutlined,
	StarFilled,
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
import { Link, useNavigate } from "react-router-dom";
import type {
	ClaimDomainRequest,
	ClaimDomainCooldownResponse,
	ClaimDomainResponse,
	DeleteDomainRequest,
	ListDomainStatusItem,
	ListDomainStatusRequest,
	ListDomainStatusResponse,
	SetPrimaryDomainRequest,
	VerifyDomainRequest,
	VerifyDomainResponse,
} from "vetchium-specs/org-domains/org-domains";
import {
	DomainVerificationStatusVerified,
	DomainVerificationStatusPending,
	DomainVerificationStatusFailing,
} from "vetchium-specs/org-domains/org-domains";
import {
	DOMAIN_MAX_LENGTH,
	DOMAIN_MIN_LENGTH,
} from "vetchium-specs/common/common";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Text, Paragraph, Title } = Typography;

interface ClaimFormValues {
	domain: string;
}

export function DomainsPage() {
	const { t, i18n } = useTranslation("auth");
	const { sessionToken } = useAuth();
	const { data: myInfo, refetch: refetchMyInfo } = useMyInfo(sessionToken);
	const { message, modal } = App.useApp();

	const canWriteDomains =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_domains") ||
		false;
	const navigate = useNavigate();
	const [form] = Form.useForm<ClaimFormValues>();

	const [domains, setDomains] = useState<ListDomainStatusItem[]>([]);
	const [domainsLoading, setDomainsLoading] = useState(false);
	const [claimLoading, setClaimLoading] = useState(false);
	const [actionDomain, setActionDomain] = useState<string | null>(null);
	const [claimResult, setClaimResult] = useState<ClaimDomainResponse | null>(
		null
	);
	const [error, setError] = useState<string | null>(null);
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
			const response = await fetch(`${apiBaseUrl}/org/list-domains`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 200) {
				const data: ListDomainStatusResponse = await response.json();
				setDomains(data.domain_statuses);
			} else if (response.status === 401) {
				navigate("/login");
			} else if (response.status === 403) {
				navigate("/");
			} else {
				setError(t("domain.loadFailed"));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domain.loadFailed"));
		} finally {
			setDomainsLoading(false);
		}
	}, [sessionToken, t, navigate]);

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
				const body: ClaimDomainCooldownResponse = await response.json();
				if (body.claimable_after) {
					const claimableDate = formatDateTime(
						body.claimable_after,
						i18n.language
					);
					setError(
						t("domain.cooldownMessage", { claimableAfter: claimableDate })
					);
				} else {
					setError(t("domain.alreadyClaimed"));
				}
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
				if (data.status === DomainVerificationStatusVerified) {
					message.success(t("domain.verifiedSuccess"));
					setInstructionsDomain(null);
				} else {
					message.info(data.message ?? t("domain.verificationPending"));
				}
				await loadDomains();
				await refetchMyInfo?.();
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

	const handleSetPrimary = async (domain: string) => {
		setActionDomain(`primary-${domain}`);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: SetPrimaryDomainRequest = { domain };

			const response = await fetch(`${apiBaseUrl}/org/set-primary-domain`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 200) {
				message.success(t("domain.setPrimarySuccess"));
				await loadDomains();
				return;
			}

			if (response.status === 422) {
				setError(t("domain.setPrimaryNotVerified"));
				return;
			}

			if (response.status === 404) {
				setError(t("domain.notFound"));
				return;
			}

			setError(t("domain.setPrimaryFailed"));
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("domain.setPrimaryFailed")
			);
		} finally {
			setActionDomain(null);
		}
	};

	const handleDeleteDomain = async (domain: string) => {
		modal.confirm({
			title: t("domain.deleteConfirmTitle"),
			content: t("domain.deleteConfirmContent", { domain }),
			okText: t("domain.deleteDomain"),
			okButtonProps: { danger: true },
			onOk: async () => {
				setActionDomain(`delete-${domain}`);
				setError(null);

				try {
					const apiBaseUrl = await getApiBaseUrl();
					const request: DeleteDomainRequest = { domain };

					const response = await fetch(`${apiBaseUrl}/org/delete-domain`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(request),
					});

					if (response.status === 204) {
						message.success(t("domain.deleteDomainSuccess"));
						await loadDomains();
						await refetchMyInfo?.();
						return;
					}

					if (response.status === 422) {
						const body = await response.json().catch(() => ({}));
						setError(body.error ?? t("domain.deleteDomainFailed"));
						return;
					}

					if (response.status === 404) {
						setError(t("domain.notFound"));
						return;
					}

					setError(t("domain.deleteDomainFailed"));
				} catch (err) {
					setError(
						err instanceof Error ? err.message : t("domain.deleteDomainFailed")
					);
				} finally {
					setActionDomain(null);
				}
			},
		});
	};

	const formatLocalTime = (isoString: string) =>
		formatDateTime(isoString, i18n.language);

	const columns = [
		{
			title: t("domain.yourDomain"),
			dataIndex: "domain",
			key: "domain",
			render: (domain: string, record: ListDomainStatusItem) => (
				<Space size={4}>
					<Tag icon={<GlobalOutlined />}>{domain}</Tag>
					{record.is_primary && (
						<Tag icon={<StarFilled />} color="gold">
							{t("domain.primaryBadge")}
						</Tag>
					)}
				</Space>
			),
		},
		{
			title: t("domain.statusLabel"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => {
				switch (status) {
					case DomainVerificationStatusVerified:
						return (
							<Tag icon={<CheckCircleOutlined />} color="success">
								{t("domain.statusVerified")}
							</Tag>
						);
					case DomainVerificationStatusPending:
						return (
							<Tag icon={<ClockCircleOutlined />} color="processing">
								{t("domain.statusPending")}
							</Tag>
						);
					case DomainVerificationStatusFailing:
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
				if (record.status === DomainVerificationStatusVerified) {
					return (
						<Space orientation="vertical" size={4}>
							{record.last_verified_at && (
								<Text type="secondary" style={{ fontSize: 12 }}>
									{t("domain.lastVerified")}:{" "}
									{formatLocalTime(record.last_verified_at)}
								</Text>
							)}
							{canWriteDomains && !record.is_primary && (
								<Button
									size="small"
									icon={<StarFilled />}
									loading={actionDomain === `primary-${record.domain}`}
									onClick={() => handleSetPrimary(record.domain)}
								>
									{t("domain.setPrimary")}
								</Button>
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
						{record.failing_since && (
							<Text type="warning" style={{ fontSize: 12 }}>
								{t("domain.failingSince")}:{" "}
								{formatLocalTime(record.failing_since)}
							</Text>
						)}
						{record.expires_at && (
							<Text type="secondary" style={{ fontSize: 12 }}>
								{t("domain.tokenExpires")}: {formatLocalTime(record.expires_at)}
							</Text>
						)}
						{canWriteDomains && (
							<Button
								size="small"
								onClick={() => setInstructionsDomain(record)}
							>
								{t("domain.showDnsInstructions")}
							</Button>
						)}
					</Space>
				);
			},
		},
		...(canWriteDomains
			? [
					{
						title: t("domain.actionsLabel"),
						key: "actions",
						render: (_: unknown, record: ListDomainStatusItem) => (
							<Button
								size="small"
								danger
								icon={<DeleteOutlined />}
								loading={actionDomain === `delete-${record.domain}`}
								onClick={() => handleDeleteDomain(record.domain)}
							>
								{t("domain.deleteDomain")}
							</Button>
						),
					},
				]
			: []),
	];

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

			{/* DNS instructions modal */}
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
					) : (
						""
					)
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
							<Text code>_vetchium-verify.{instructionsDomain.domain}</Text>
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

			{canWriteDomains && (
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
			)}
		</div>
	);
}
