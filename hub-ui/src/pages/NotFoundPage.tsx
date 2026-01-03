import { Button, Layout, Result } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

const { Content } = Layout;

export function NotFoundPage() {
    const { t } = useTranslation("common");
    const navigate = useNavigate();

    return (
        <Layout style={{ minHeight: "100vh" }}>
            <Content
                style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                }}
            >
                <Result
                    status="404"
                    title="404"
                    subTitle={t("errors.pageNotFound")}
                    extra={
                        <Button type="primary" onClick={() => navigate("/")}>
                            {t("action.backHome")}
                        </Button>
                    }
                />
            </Content>
        </Layout>
    );
}
