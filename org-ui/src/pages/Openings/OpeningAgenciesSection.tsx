import React, { useCallback, useEffect, useState } from "react";
import { AutoComplete, Button, Card, Modal, Table, App as AntApp } from "antd";
import { useTranslation } from "react-i18next";
import { PlusOutlined } from "@ant-design/icons";
import type {
	OpeningAgency,
	ListOpeningAgenciesResponse,
	AssignOpeningAgencyRequest,
	RemoveOpeningAgencyRequest,
	AssignableAgency,
	ListAssignableAgenciesResponse,
} from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDate } from "../../utils/dateFormat";

interface Props {
	openingId: string;
}

/**
 * Consumer-side section on the opening detail page: lists official recruiting
 * agencies assigned to this opening, with assign/remove actions.
 */
const OpeningAgenciesSection: React.FC<Props> = ({ openingId }) => {
	const { t, i18n } = useTranslation("agencyReferrals");
	const { sessionToken } = useAuth();
	const { message } = AntApp.useApp();
	const [agencies, setAgencies] = useState<OpeningAgency[]>([]);
	const [loading, setLoading] = useState(false);
	const [modalOpen, setModalOpen] = useState(false);
	const [domain, setDomain] = useState("");
	const [saving, setSaving] = useState(false);
	const [assignable, setAssignable] = useState<AssignableAgency[]>([]);

	const fetchAssignable = useCallback(async () => {
		if (!sessionToken) return;
		const baseUrl = await getApiBaseUrl();
		const res = await fetch(`${baseUrl}/org/list-assignable-agencies`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			},
			body: JSON.stringify({}),
		});
		if (res.status === 200) {
			const data: ListAssignableAgenciesResponse = await res.json();
			setAssignable(data.agencies ?? []);
		}
	}, [sessionToken]);

	const fetchAgencies = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const res = await fetch(`${baseUrl}/org/list-opening-agencies`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ opening_id: openingId }),
			});
			if (res.status === 200) {
				const data: ListOpeningAgenciesResponse = await res.json();
				setAgencies(data.agencies ?? []);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, openingId]);

	useEffect(() => {
		fetchAgencies();
	}, [fetchAgencies]);

	const handleAssign = async () => {
		if (!sessionToken || domain.trim() === "") return;
		setSaving(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const body: AssignOpeningAgencyRequest = {
				opening_id: openingId,
				agency_org_domain: domain.trim(),
			};
			const res = await fetch(`${baseUrl}/org/assign-opening-agency`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			if (res.status === 200) {
				message.success(t("assignSuccess"));
				setModalOpen(false);
				setDomain("");
				fetchAgencies();
			} else if (res.status === 404) {
				message.error(t("errCandidateNotFound"));
			} else if (res.status === 422) {
				message.error(t("noAgencyWarning"));
			} else {
				message.error(t("errGeneric"));
			}
		} finally {
			setSaving(false);
		}
	};

	const handleRemove = async (agencyDomain: string) => {
		if (!sessionToken) return;
		const baseUrl = await getApiBaseUrl();
		const body: RemoveOpeningAgencyRequest = {
			opening_id: openingId,
			agency_org_domain: agencyDomain,
		};
		const res = await fetch(`${baseUrl}/org/remove-opening-agency`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			},
			body: JSON.stringify(body),
		});
		if (res.status === 200) {
			message.success(t("removeSuccess"));
			fetchAgencies();
		}
	};

	const columns = [
		{
			title: t("agencyColumn"),
			key: "agency",
			render: (_: unknown, r: OpeningAgency) =>
				`${r.agency_org_name} (${r.agency_org_domain})`,
		},
		{
			title: t("assignedAt"),
			dataIndex: "assigned_at",
			key: "assigned_at",
			render: (v: string) => formatDate(v, i18n.language),
		},
		{
			title: t("referralsMade"),
			dataIndex: "referrals_made",
			key: "referrals_made",
		},
		{
			title: "",
			key: "actions",
			render: (_: unknown, r: OpeningAgency) => (
				<Button
					danger
					size="small"
					onClick={() => handleRemove(r.agency_org_domain)}
				>
					{t("remove")}
				</Button>
			),
		},
	];

	return (
		<Card
			title={t("openingAgenciesTitle")}
			style={{ marginBottom: 16 }}
			extra={
				<Button
					type="primary"
					size="small"
					icon={<PlusOutlined />}
					onClick={() => {
						setModalOpen(true);
						fetchAssignable();
					}}
				>
					{t("assignAgency")}
				</Button>
			}
		>
			<Table
				columns={columns}
				dataSource={agencies}
				rowKey="agency_org_domain"
				loading={loading}
				pagination={false}
				size="small"
			/>
			<Modal
				title={t("assignAgency")}
				open={modalOpen}
				onOk={handleAssign}
				confirmLoading={saving}
				onCancel={() => setModalOpen(false)}
			>
				<p>{t("selectAgency")}</p>
				<AutoComplete
					style={{ width: "100%" }}
					placeholder="agency.example.com"
					value={domain}
					onChange={(value) => setDomain(value)}
					showSearch={{
						filterOption: (input, option) =>
							(option?.value ?? "")
								.toLowerCase()
								.includes(input.toLowerCase()) ||
							(option?.label ?? "")
								.toString()
								.toLowerCase()
								.includes(input.toLowerCase()),
					}}
					options={assignable
						.filter(
							(a) =>
								!agencies.some(
									(assigned) =>
										assigned.agency_org_domain === a.agency_org_domain
								)
						)
						.map((a) => ({
							value: a.agency_org_domain,
							label: `${a.agency_org_name} (${a.agency_org_domain})`,
						}))}
					notFoundContent={t("noAssignableAgencies")}
				/>
			</Modal>
		</Card>
	);
};

export default OpeningAgenciesSection;
