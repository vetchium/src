import "@typespec/openapi";
import "./localization.tsp";

namespace Vetchium;

@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["on_site", "hybrid", "remote"]
)
scalar OpeningWorkArrangement extends string;

@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["full_time", "part_time", "contract", "internship"]
)
scalar OpeningEmploymentType extends string;

@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["secondary", "bachelor", "master", "doctorate"]
)
scalar OpeningEducation extends string;

@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["hour", "day", "month", "year"]
)
scalar OpeningSalaryPeriod extends string;

@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["worldwide", "countries"]
)
scalar OpeningRemoteEligibilityKind extends string;

model OpeningRemoteEligibility {
  kind: OpeningRemoteEligibilityKind;
  countries?: CountryCode[];
}

model OpeningExperienceYears {
  min?: int32;
  max?: int32;
}

/** Whole currency units, at most 10^12 so every value is exact in JavaScript. */
model OpeningSalary {
  currency: string;

  @minValue(0)
  @maxValue(1000000000000)
  min: int64;

  @minValue(1)
  @maxValue(1000000000000)
  max: int64;

  period: OpeningSalaryPeriod;
}

/** A working copy can contain any subset of valid fields. */
model OpeningContent {
  title?: string;
  description?: string;
  language?: string;
  employing_country?: CountryCode;
  work_arrangement?: OpeningWorkArrangement;
  location_details?: string;
  remote_eligibility?: OpeningRemoteEligibility;
  employment_type?: OpeningEmploymentType;
  positions?: int32;
  experience_years?: OpeningExperienceYears;
  minimum_education?: OpeningEducation;
  salary?: OpeningSalary;
}
