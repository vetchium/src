import React, { useCallback, useEffect, useState } from "react";
import {
	Form,
	Button,
	Input,
	Select,
	Checkbox,
	Card,
	Spin,
	message,
	InputNumber,
	Typography,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import type { ValidationError } from "vetchium-specs/common/common";
import type {
	CreateOpeningRequest,
	CreateOpeningResponse,
} from "vetchium-specs/org/openings";
import type { OrgAddress } from "vetchium-specs/org/company-addresses";
import type { CostCenter } from "vetchium-specs/org/cost-centers";
import type { Tag } from "vetchium-specs/org/tags";
import type { OrgUser } from "vetchium-specs/org/org-users";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

type OpeningFormValues = Omit<CreateOpeningRequest, "salary"> & {
	salary_min?: number;
	salary_max?: number;
	salary_currency?: string;
};

export default function CreateOpeningPage() {
	const { t } = useTranslation("openings");
	const navigate = useNavigate();
	const { sessionToken } = useAuth();
	const [form] = Form.useForm();
	const [loading, setLoading] = useState(false);
	const [formErrors, setFormErrors] = useState<ValidationError[]>([]);

	const [addresses, setAddresses] = useState<OrgAddress[]>([]);
	const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
	const [tags, setTags] = useState<Tag[]>([]);
	const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
	const [optionsLoading, setOptionsLoading] = useState(false);

	const loadOptions = useCallback(async () => {
		if (!sessionToken) return;
		setOptionsLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const headers = {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			};

			const [addrResp, ccResp, tagResp, usersResp] = await Promise.all([
				fetch(`${baseUrl}/org/list-addresses`, {
					method: "POST",
					headers,
					body: JSON.stringify({ limit: 100 }),
				}),
				fetch(`${baseUrl}/org/list-cost-centers`, {
					method: "POST",
					headers,
					body: JSON.stringify({ limit: 100 }),
				}),
				fetch(`${baseUrl}/org/list-tags`, {
					method: "POST",
					headers,
					body: JSON.stringify({ limit: 100 }),
				}),
				fetch(`${baseUrl}/org/list-users`, {
					method: "POST",
					headers,
					body: JSON.stringify({ limit: 100, filter_status: "active" }),
				}),
			]);

			if (addrResp.status === 200) {
				const data = await addrResp.json();
				setAddresses(
					(data.addresses ?? []).filter(
						(a: OrgAddress) => a.status === "active"
					)
				);
			}
			if (ccResp.status === 200) {
				const data = await ccResp.json();
				setCostCenters(
					(data.items ?? []).filter((c: CostCenter) => c.status === "enabled")
				);
			}
			if (tagResp.status === 200) {
				const data = await tagResp.json();
				setTags(data.tags ?? []);
			}
			if (usersResp.status === 200) {
				const data = await usersResp.json();
				setOrgUsers(data.items ?? []);
			}
		} catch {
			// non-fatal — options may be empty
		} finally {
			setOptionsLoading(false);
		}
	}, [sessionToken]);

	useEffect(() => {
		void loadOptions();
	}, [loadOptions]);

	const onFinish = async (values: OpeningFormValues) => {
		if (!sessionToken) return;
		setLoading(true);
		setFormErrors([]);
		try {
			const salary =
				values.salary_min !== undefined &&
				values.salary_max !== undefined &&
				values.salary_currency
					? {
							min_amount: values.salary_min,
							max_amount: values.salary_max,
							currency: values.salary_currency,
						}
					: undefined;

			const req: CreateOpeningRequest = {
				title: values.title,
				description: values.description,
				is_internal: values.is_internal || false,
				employment_type: values.employment_type,
				work_location_type: values.work_location_type,
				address_ids: values.address_ids || [],
				min_yoe: values.min_yoe,
				max_yoe: values.max_yoe,
				min_education_level: values.min_education_level,
				salary,
				number_of_positions: values.number_of_positions,
				hiring_manager_email_address: values.hiring_manager_email_address,
				recruiter_email_address: values.recruiter_email_address,
				hiring_team_member_email_addresses:
					values.hiring_team_member_email_addresses,
				watcher_email_addresses: values.watcher_email_addresses,
				cost_center_id: values.cost_center_id,
				tag_ids: values.tag_ids,
				internal_notes: values.internal_notes,
			};

			const baseUrl = await getApiBaseUrl();
			const response = await fetch(`${baseUrl}/org/create-opening`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});

			if (response.status === 201) {
				const createdOpening: CreateOpeningResponse = await response.json();
				message.success(t("success.created"));
				navigate(`/openings/${createdOpening.opening_number}`);
			} else if (response.status === 400) {
				const errors: ValidationError[] = await response.json();
				setFormErrors(errors);
				message.error(t("errors.saveFailed"));
			} else {
				message.error(t("errors.saveFailed"));
			}
		} catch {
			message.error(t("errors.saveFailed"));
		} finally {
			setLoading(false);
		}
	};

	const hasErrors = formErrors.length > 0;

	const userOptions = orgUsers.map((u) => ({
		label: u.name ? `${u.name} (${u.email_address})` : u.email_address,
		value: u.email_address,
	}));

	const addressOptions = addresses.map((a) => ({
		label: `${a.title} — ${a.city}, ${a.country}`,
		value: a.address_id,
	}));

	const costCenterOptions = costCenters.map((c) => ({
		label: c.display_name,
		value: c.cost_center_id,
	}));

	const tagOptions = tags.map((tag) => ({
		label: tag.display_name || tag.tag_id,
		value: tag.tag_id,
	}));

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
				<Link to="/openings">
					<Button icon={<ArrowLeftOutlined />}>{t("backToOpenings")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("createOpening")}
			</Title>

			<Spin spinning={loading || optionsLoading}>
				<Form
					form={form}
					onFinish={onFinish}
					layout="vertical"
					autoComplete="off"
				>
					{/* Basics */}
					<Card title={t("form.sections.basics")} style={{ marginBottom: 16 }}>
						<Form.Item
							label={t("form.title")}
							name="title"
							rules={[{ required: true, message: t("form.titleRequired") }]}
						>
							<Input name="title" maxLength={200} placeholder={t("form.title")} />
						</Form.Item>

						<Form.Item
							label={t("form.description")}
							name="description"
							rules={[{ required: true, message: t("form.required") }]}
						>
							<Input.TextArea
								maxLength={10000}
								rows={5}
								placeholder={t("form.description")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.isInternal")}
							name="is_internal"
							valuePropName="checked"
						>
							<Checkbox>{t("form.isInternal")}</Checkbox>
						</Form.Item>
					</Card>

					{/* Employment */}
					<Card
						title={t("form.sections.employment")}
						style={{ marginBottom: 16 }}
					>
						<Form.Item
							label={t("form.employmentType")}
							name="employment_type"
							rules={[{ required: true, message: t("form.required") }]}
						>
							<Select
								placeholder={t("form.employmentType")}
								options={[
									{ label: t("form.full_time"), value: "full_time" },
									{ label: t("form.part_time"), value: "part_time" },
									{ label: t("form.contract"), value: "contract" },
									{ label: t("form.internship"), value: "internship" },
								]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.workLocationType")}
							name="work_location_type"
							rules={[{ required: true, message: t("form.required") }]}
						>
							<Select
								placeholder={t("form.workLocationType")}
								options={[
									{ label: t("form.remote"), value: "remote" },
									{ label: t("form.on_site"), value: "on_site" },
									{ label: t("form.hybrid"), value: "hybrid" },
								]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.addresses")}
							name="address_ids"
							rules={[{ required: true, message: t("form.required") }]}
						>
							<Select
								mode="multiple"
								placeholder={t("form.addresses")}
								options={addressOptions}
							/>
						</Form.Item>
					</Card>

					{/* Requirements */}
					<Card
						title={t("form.sections.requirements")}
						style={{ marginBottom: 16 }}
					>
						<Form.Item label={t("form.minYoe")} name="min_yoe">
							<InputNumber min={0} max={100} placeholder={t("form.minYoe")} />
						</Form.Item>

						<Form.Item label={t("form.maxYoe")} name="max_yoe">
							<InputNumber min={1} max={100} placeholder={t("form.maxYoe")} />
						</Form.Item>

						<Form.Item
							label={t("form.minEducationLevel")}
							name="min_education_level"
						>
							<Select
								placeholder={t("form.minEducationLevel")}
								options={[
									{ label: "Not Required", value: "not_required" },
									{ label: "Bachelor", value: "bachelor" },
									{ label: "Master", value: "master" },
									{ label: "Doctorate", value: "doctorate" },
								]}
							/>
						</Form.Item>
					</Card>

					{/* Compensation */}
					<Card
						title={t("form.sections.compensation")}
						style={{ marginBottom: 16 }}
					>
						<Form.Item label={t("form.salaryMin")} name="salary_min">
							<InputNumber min={0} placeholder={t("form.salaryMin")} />
						</Form.Item>

						<Form.Item label={t("form.salaryMax")} name="salary_max">
							<InputNumber min={0} placeholder={t("form.salaryMax")} />
						</Form.Item>

						<Form.Item label={t("form.salaryCurrency")} name="salary_currency">
							<Input maxLength={3} placeholder="USD" />
						</Form.Item>
					</Card>

					{/* Team */}
					<Card title={t("form.sections.team")} style={{ marginBottom: 16 }}>
						<Form.Item
							label={t("form.hiringManager")}
							name="hiring_manager_email_address"
							rules={[{ required: true, message: t("form.required") }]}
						>
							<Select
								showSearch={{ optionFilterProp: "label" }}
								placeholder={t("form.hiringManager")}
								options={userOptions}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.recruiter")}
							name="recruiter_email_address"
							rules={[{ required: true, message: t("form.required") }]}
						>
							<Select
								showSearch={{ optionFilterProp: "label" }}
								placeholder={t("form.recruiter")}
								options={userOptions}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.hiringTeamMembers")}
							name="hiring_team_member_email_addresses"
						>
							<Select
								mode="multiple"
								showSearch={{ optionFilterProp: "label" }}
								placeholder={t("form.hiringTeamMembers")}
								options={userOptions}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.watchers")}
							name="watcher_email_addresses"
						>
							<Select
								mode="multiple"
								showSearch={{ optionFilterProp: "label" }}
								placeholder={t("form.watchers")}
								options={userOptions}
							/>
						</Form.Item>
					</Card>

					{/* Additional */}
					<Card
						title={t("form.sections.additional")}
						style={{ marginBottom: 16 }}
					>
						<Form.Item label={t("form.costCenter")} name="cost_center_id">
							<Select
								placeholder={t("form.costCenter")}
								options={costCenterOptions}
								allowClear
							/>
						</Form.Item>

						<Form.Item label={t("form.tags")} name="tag_ids">
							<Select
								mode="multiple"
								showSearch={{ optionFilterProp: "label" }}
								placeholder={t("form.tags")}
								options={tagOptions}
							/>
						</Form.Item>

						<Form.Item label={t("form.internalNotes")} name="internal_notes">
							<Input.TextArea
								maxLength={2000}
								rows={3}
								placeholder={t("form.internalNotes")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.numberOfPositions")}
							name="number_of_positions"
							rules={[{ required: true, message: t("form.required") }]}
						>
							<InputNumber
								min={1}
								max={100}
								placeholder={t("form.numberOfPositions")}
							/>
						</Form.Item>
					</Card>

					{formErrors.length > 0 && (
						<Card
							style={{
								marginBottom: 16,
								borderColor: "#ff4d4f",
								backgroundColor: "#fff1f0",
							}}
						>
							{formErrors.map((error, idx) => (
								<div key={idx} style={{ color: "#ff4d4f" }}>
									{error.field}: {error.message}
								</div>
							))}
						</Card>
					)}

					<Form.Item>
						<Button
							type="primary"
							htmlType="submit"
							loading={loading}
							disabled={hasErrors}
							block
						>
							{t("form.saveAsDraft")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
}
