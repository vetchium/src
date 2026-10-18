import "@typespec/openapi";

namespace Vetchium.Orgs.Marketplace;

/**
 * A seeded service an Org can provide, identical in every tenant. A portal
 * older than its API shows a Capability it does not recognize as the raw
 * value. `sourcing` works on whole Openings; the others perform one stage
 * kind each (`interviewing`: `interview`, `assessment`: `assessment`,
 * `background_check`: `background_check`). `review` stages are in-house only.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["sourcing", "interviewing", "assessment", "background_check"]
)
@TypeSpec.OpenAPI.extension(
  "x-vetchium-capability-stage-kinds",
  #{
    interviewing: "interview",
    assessment: "assessment",
    background_check: "background_check",
  }
)
scalar Capability extends string;
