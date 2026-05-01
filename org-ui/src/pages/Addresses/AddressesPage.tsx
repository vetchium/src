import {
	ArrowLeftOutlined,
	EditOutlined,
	PlusOutlined,
	MinusCircleOutlined,
} from "@ant-design/icons";
import {
	App,
	Button,
	Form,
	Input,
	Modal,
	Space,
	Spin,
	Table,
	Tag,
	Tabs,
	Typography,
	Popconfirm,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	CreateAddressRequest,
	OrgAddress,
	ListAddressesRequest,
	UpdateAddressRequest,
	OrgAddressStatus,
} from "vetchium-specs/org/company-addresses";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text } = Typography;

type FilterStatus = OrgAddressStatus | undefined;

function AddressFormItems() {
	const { t } = useTranslation("addresses");
	return (
		<>
			<Form.Item
				name="title"
				label={t("form.titleLabel")}
				rules={[
					{ required: true, message: t("errors.fieldRequired", "Required") },
					{ max: 100 },
				]}
			>
				<Input placeholder={t("form.titlePlaceholder")} />
			</Form.Item>
			<Form.Item
				name="address_line1"
				label={t("form.addressLine1Label")}
				rules={[
					{ required: true, message: t("errors.fieldRequired", "Required") },
					{ max: 200 },
				]}
			>
				<Input />
			</Form.Item>
			<Form.Item
				name="address_line2"
				label={t("form.addressLine2Label")}
				rules={[{ max: 200 }]}
			>
				<Input />
			</Form.Item>
			<Space style={{ display: "flex", width: "100%" }} align="baseline">
				<Form.Item
					name="city"
					label={t("form.cityLabel")}
					rules={[
						{ required: true, message: t("errors.fieldRequired", "Required") },
						{ max: 100 },
					]}
				>
					<Input />
				</Form.Item>
				<Form.Item
					name="state"
					label={t("form.stateLabel")}
					rules={[{ max: 100 }]}
				>
					<Input />
				</Form.Item>
			</Space>
			<Space style={{ display: "flex", width: "100%" }} align="baseline">
				<Form.Item
					name="postal_code"
					label={t("form.postalCodeLabel")}
					rules={[{ max: 20 }]}
				>
					<Input />
				</Form.Item>
				<Form.Item
					name="country"
					label={t("form.countryLabel")}
					rules={[
						{ required: true, message: t("errors.fieldRequired", "Required") },
						{ max: 100 },
					]}
				>
					<Input />
				</Form.Item>
			</Space>

			<Form.List name="map_urls">
				{(fields, { add, remove }) => (
					<>
						<div style={{ marginBottom: 8 }}>{t("form.mapUrlsLabel")}</div>
						{fields.map((field) => (
							<Space
								key={field.key}
								style={{ display: "flex", marginBottom: 8 }}
								align="baseline"
							>
								<Form.Item
									{...field}
									rules={[
										{ type: "url", message: "Must be a valid URL" },
										{ max: 500 },
									]}
									noStyle
								>
									<Input placeholder="https://..." style={{ width: 400 }} />
								</Form.Item>
								<MinusCircleOutlined onClick={() => remove(field.name)} />
							</Space>
						))}
						{fields.length < 5 && (
							<Form.Item>
								<Button
									type="dashed"
									onClick={() => add()}
									block
									icon={<PlusOutlined />}
								>
									{t("form.addMapUrl")}
								</Button>
							</Form.Item>
						)}
					</>
				)}
			</Form.List>
		</>
	);
}

export function AddressesPage() {
	const { t } = useTranslation("addresses");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_addresses") ||
		false;

	const [addresses, setAddresses] = useState<OrgAddress[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>();
	const [filterStatus, setFilterStatus] = useState<FilterStatus>(undefined);

	const [addModalOpen, setAddModalOpen] = useState(false);
	const [addLoading, setAddLoading] = useState(false);
	const [addForm] = Form.useForm();

	const [editModalOpen, setEditModalOpen] = useState(false);
	const [editLoading, setEditLoading] = useState(false);
	const [editingAddress, setEditingAddress] = useState<OrgAddress | null>(null);
	const [editForm] = Form.useForm();
	const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

	const loadAddresses = useCallback(
		async (paginationKey?: string, status?: FilterStatus, reset?: boolean) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListAddressesRequest = {
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
					...(status ? { filter_status: status } : {}),
				};
				const resp = await fetch(`${baseUrl}/org/list-addresses`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					if (reset) {
						setAddresses(data.addresses ?? []);
					} else {
						setAddresses((prev) => [...prev, ...(data.addresses ?? [])]);
					}
					setNextPaginationKey(data.next_pagination_key);
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	useEffect(() => {
		loadAddresses(undefined, filterStatus, true);
	}, [filterStatus, loadAddresses]);

	const handleTabChange = (key: string) => {
		const status: FilterStatus =
			key === "active" ? "active" : key === "disabled" ? "disabled" : undefined;
		setFilterStatus(status);
		setNextPaginationKey(undefined);
	};

	const handleLoadMore = () => {
		if (nextPaginationKey) {
			loadAddresses(nextPaginationKey, filterStatus, false);
		}
	};

	const handleAdd = async (values: CreateAddressRequest) => {
		if (!sessionToken) return;
		setAddLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/create-address`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(values),
			});
			if (resp.status === 201) {
				message.success(t("success.created"));
				setAddModalOpen(false);
				addForm.resetFields();
				loadAddresses(undefined, filterStatus, true);
			} else if (resp.status === 400) {
				const errs = await resp.json().catch(() => []);
				if (Array.isArray(errs) && errs.length > 0) {
					message.error(errs[0].message ?? t("errors.saveFailed"));
				} else {
					message.error(t("errors.saveFailed"));
				}
			} else {
				message.error(t("errors.saveFailed"));
			}
		} catch {
			message.error(t("errors.saveFailed"));
		} finally {
			setAddLoading(false);
		}
	};

	const handleEdit = (addr: OrgAddress) => {
		setEditingAddress(addr);
		editForm.setFieldsValue({
			...addr,
			map_urls:
				addr.map_urls && addr.map_urls.length > 0 ? addr.map_urls : [""],
		});
		setEditModalOpen(true);
	};

	const handleUpdate = async (values: CreateAddressRequest) => {
		if (!sessionToken || !editingAddress) return;
		setEditLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: UpdateAddressRequest = {
				address_id: editingAddress.address_id,
				...values,
			};
			const resp = await fetch(`${baseUrl}/org/update-address`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("success.updated"));
				setEditModalOpen(false);
				editForm.resetFields();
				setEditingAddress(null);
				loadAddresses(undefined, filterStatus, true);
			} else if (resp.status === 404) {
				message.error(t("errors.notFound", "Address not found"));
			} else if (resp.status === 400) {
				const errs = await resp.json().catch(() => []);
				if (Array.isArray(errs) && errs.length > 0) {
					message.error(errs[0].message ?? t("errors.saveFailed"));
				} else {
					message.error(t("errors.saveFailed"));
				}
			} else {
				message.error(t("errors.saveFailed"));
			}
		} catch {
			message.error(t("errors.saveFailed"));
		} finally {
			setEditLoading(false);
		}
	};

	const handleToggleStatus = async (addr: OrgAddress) => {
		if (!sessionToken) return;
		const isDisabling = addr.status === "active";
		const endpoint = isDisabling
			? "/org/disable-address"
			: "/org/enable-address";
		setActionLoadingId(addr.address_id);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ address_id: addr.address_id }),
			});
			if (resp.status === 200) {
				message.success(
					isDisabling ? t("success.disabled") : t("success.enabled")
				);
				loadAddresses(undefined, filterStatus, true);
			} else if (resp.status === 422) {
				const body = await resp.json().catch(() => ({}));
				message.error(
					body.message ||
						(isDisabling ? t("errors.disableFailed") : t("errors.enableFailed"))
				);
			} else {
				message.error(
					isDisabling ? t("errors.disableFailed") : t("errors.enableFailed")
				);
			}
		} catch {
			message.error(
				isDisabling ? t("errors.disableFailed") : t("errors.enableFailed")
			);
		} finally {
			setActionLoadingId(null);
		}
	};

	const columns = [
		{
			title: t("table.title"),
			dataIndex: "title",
			key: "title",
			render: (title: string) => <Text strong>{title}</Text>,
		},
		{
			title: t("table.address"),
			key: "address",
			render: (_: unknown, record: OrgAddress) => (
				<div>
					<div>{record.address_line1}</div>
					{record.address_line2 && (
						<div style={{ fontSize: "0.9em", color: "rgba(0,0,0,0.45)" }}>
							{record.address_line2}
						</div>
					)}
				</div>
			),
		},
		{
			title: t("table.city"),
			dataIndex: "city",
			key: "city",
		},
		{
			title: t("table.country"),
			dataIndex: "country",
			key: "country",
		},
		{
			title: t("table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={status === "active" ? "green" : "default"}>
					{t(`status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
				</Tag>
			),
		},
		{
			title: t("table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (createdAt: string) => formatDateTime(createdAt),
		},
		...(canManage
			? [
					{
						title: t("table.actions"),
						key: "actions",
						render: (_: unknown, record: OrgAddress) => (
							<Space>
								<Button
									icon={<EditOutlined />}
									size="small"
									onClick={() => handleEdit(record)}
								>
									{t("table.edit")}
								</Button>
								<Popconfirm
									title={
										record.status === "active"
											? t("disableConfirm")
											: t("enableConfirm")
									}
									onConfirm={() => handleToggleStatus(record)}
									okText={t("common:yes", "Yes")}
									cancelText={t("common:no", "No")}
									disabled={actionLoadingId === record.address_id}
								>
									<Button
										size="small"
										danger={record.status === "active"}
										loading={actionLoadingId === record.address_id}
									>
										{record.status === "active"
											? t("table.disable")
											: t("table.reenable")}
									</Button>
								</Popconfirm>
							</Space>
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

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 24,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("title")}
				</Title>
				{canManage && (
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => {
							addForm.resetFields();
							addForm.setFieldsValue({ map_urls: [] });
							setAddModalOpen(true);
						}}
					>
						{t("addAddress")}
					</Button>
				)}
			</div>

			<Tabs
				defaultActiveKey="all"
				onChange={handleTabChange}
				items={[
					{ key: "all", label: t("filterAll") },
					{ key: "active", label: t("filterActive") },
					{ key: "disabled", label: t("filterDisabled") },
				]}
			/>

			<Spin spinning={loading}>
				<Table
					dataSource={addresses}
					columns={columns}
					rowKey="address_id"
					pagination={false}
					locale={{ emptyText: t("common:table.empty") }}
				/>
			</Spin>

			{nextPaginationKey && (
				<Button
					onClick={handleLoadMore}
					loading={loading}
					block
					style={{ marginTop: 16 }}
				>
					{t("loadMore")}
				</Button>
			)}

			{/* Add Address Modal */}
			<Modal
				title={t("addModal.title")}
				open={addModalOpen}
				onCancel={() => {
					setAddModalOpen(false);
					addForm.resetFields();
				}}
				footer={null}
				width={600}
				destroyOnHidden
			>
				<Spin spinning={addLoading}>
					<Form
						form={addForm}
						layout="vertical"
						onFinish={handleAdd}
						initialValues={{ map_urls: [] }}
					>
						<AddressFormItems />
						<Form.Item style={{ marginTop: 24 }}>
							<Button
								type="primary"
								htmlType="submit"
								loading={addLoading}
								block
								size="large"
							>
								{t("form.saveAddress")}
							</Button>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>

			{/* Edit Address Modal */}
			<Modal
				title={t("editModal.title")}
				open={editModalOpen}
				onCancel={() => {
					setEditModalOpen(false);
					editForm.resetFields();
					setEditingAddress(null);
				}}
				footer={null}
				width={600}
				destroyOnHidden
			>
				<Spin spinning={editLoading}>
					<Form form={editForm} layout="vertical" onFinish={handleUpdate}>
						<AddressFormItems />
						<Form.Item style={{ marginTop: 24 }}>
							<Button
								type="primary"
								htmlType="submit"
								loading={editLoading}
								block
								size="large"
							>
								{t("form.saveAddress")}
							</Button>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
