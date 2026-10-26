import "@typespec/openapi";

namespace Vetchium.Orgs.Hiring;

/**
 * The kind of work a pipeline stage records. A portal older than its API shows
 * a kind it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["review", "assessment", "interview", "background_check"]
)
scalar StageKind extends string;

/**
 * The kind of check a background-check stage runs. A portal older than its API
 * shows a type it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #[
    "identity",
    "education",
    "employment",
    "criminal",
    "address",
    "credit",
    "drug"
  ]
)
scalar CheckType extends string;
