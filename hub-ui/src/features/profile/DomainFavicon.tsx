import { Space } from "antd";
import { isProfessionalDomain } from "typespec/common/domain";

/**
 * Renders a professional domain with its favicon (spec PROF-ICO-001..003).
 * The request carries no referrer or credentials, and a failed or
 * undecodable favicon is hidden rather than shown broken — it is purely
 * decorative and never implies Vetchium verified the domain.
 */
export function DomainFavicon({ value }: { value: string }) {
  if (!isProfessionalDomain(value)) return <span>{value}</span>;
  return (
    <Space size="small">
      <img
        src={`https://${value}/favicon.ico`}
        alt=""
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        width={16}
        height={16}
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
      <span>{value}</span>
    </Space>
  );
}
