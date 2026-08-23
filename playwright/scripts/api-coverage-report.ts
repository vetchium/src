import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const HTTP_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);
const STATUS_PATTERN = /^[1-5][0-9][0-9]$/;
const PROBLEM_TYPE_PREFIX = "vetchium-problem-details/";
// These responses require ingress throttling or server-side fault injection,
// neither of which Playwright can exercise as application behavior.
const PLAYWRIGHT_UNTESTABLE_STATUSES = new Set(["429", "500"]);
const PLAYWRIGHT_UNTESTABLE_VARIANTS = new Set([
  "POST /api/admin/disable-user 409 vetchium-problem-details/last-admin-manager",
]);

type JSONObject = Record<string, unknown>;

interface APIObservation {
  method: string;
  path: string;
  status: number;
  problemType?: string;
}

interface ContractResponse {
  problemTypes: Set<string>;
}

interface ContractOperation {
  key: string;
  method: string;
  path: string;
  operationID: string;
  responses: Map<string, ContractResponse>;
}

function isObject(value: unknown): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, description: string): JSONObject {
  if (!isObject(value)) throw new Error(`${description} must be an object`);
  return value;
}

function resolveReference(document: JSONObject, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;
  let value: unknown = document;
  for (const encodedPart of reference.slice(2).split("/")) {
    if (!isObject(value)) return undefined;
    const part = encodedPart.replaceAll("~1", "/").replaceAll("~0", "~");
    value = value[part];
  }
  return value;
}

function collectProblemTypes(
  schema: unknown,
  document: JSONObject,
  visitedReferences = new Set<string>(),
): Set<string> {
  const result = new Set<string>();
  if (!isObject(schema)) return result;

  if (typeof schema.$ref === "string" && !visitedReferences.has(schema.$ref)) {
    const nextVisited = new Set(visitedReferences).add(schema.$ref);
    for (const type of collectProblemTypes(
      resolveReference(document, schema.$ref),
      document,
      nextVisited,
    )) {
      result.add(type);
    }
  }

  for (const composition of ["allOf", "anyOf", "oneOf"] as const) {
    const members = schema[composition];
    if (!Array.isArray(members)) continue;
    for (const member of members) {
      for (const type of collectProblemTypes(
        member,
        document,
        visitedReferences,
      )) {
        result.add(type);
      }
    }
  }

  const properties = schema.properties;
  if (isObject(properties)) {
    const typeProperty = properties.type;
    if (isObject(typeProperty)) {
      if (
        typeof typeProperty.const === "string" &&
        typeProperty.const.startsWith(PROBLEM_TYPE_PREFIX)
      ) {
        result.add(typeProperty.const);
      }
      if (Array.isArray(typeProperty.enum)) {
        for (const value of typeProperty.enum) {
          if (
            typeof value === "string" &&
            value.startsWith(PROBLEM_TYPE_PREFIX)
          ) {
            result.add(value);
          }
        }
      }
      for (const type of collectProblemTypes(
        typeProperty,
        document,
        visitedReferences,
      )) {
        result.add(type);
      }
    }
  }

  return result;
}

function responseProblemTypes(
  response: JSONObject,
  document: JSONObject,
): Set<string> {
  const result = new Set<string>();
  const content = response.content;
  if (!isObject(content)) return result;
  for (const [mediaType, media] of Object.entries(content)) {
    if (!mediaType.includes("json") || !isObject(media)) continue;
    for (const type of collectProblemTypes(media.schema, document)) {
      result.add(type);
    }
  }
  return result;
}

function contractOperations(document: JSONObject): ContractOperation[] {
  const paths = requireObject(document.paths, "OpenAPI paths");
  const result: ContractOperation[] = [];
  for (const [path, pathItemValue] of Object.entries(paths)) {
    const pathItem = requireObject(pathItemValue, `OpenAPI path ${path}`);
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const operation = requireObject(
        operationValue,
        `${method.toUpperCase()} ${path}`,
      );
      const responses = requireObject(
        operation.responses,
        `${method.toUpperCase()} ${path} responses`,
      );
      const contractResponses = new Map<string, ContractResponse>();
      for (const [status, responseValue] of Object.entries(responses)) {
        if (!STATUS_PATTERN.test(status)) continue;
        const response = requireObject(
          responseValue,
          `${method.toUpperCase()} ${path} response ${status}`,
        );
        contractResponses.set(status, {
          problemTypes: responseProblemTypes(response, document),
        });
      }
      const upperMethod = method.toUpperCase();
      result.push({
        key: `${upperMethod} ${path}`,
        method: upperMethod,
        path,
        operationID:
          typeof operation.operationId === "string"
            ? operation.operationId
            : `${upperMethod} ${path}`,
        responses: contractResponses,
      });
    }
  }
  return result.sort((left, right) => left.key.localeCompare(right.key));
}

function pathPattern(path: string): RegExp {
  const escaped = path
    .split("/")
    .map((part) =>
      part.startsWith("{") && part.endsWith("}")
        ? "[^/]+"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function matchingOperation(
  operations: ContractOperation[],
  observation: APIObservation,
): ContractOperation | undefined {
  return (
    operations.find(
      (operation) =>
        operation.method === observation.method &&
        operation.path === observation.path,
    ) ??
    operations.find(
      (operation) =>
        operation.method === observation.method &&
        pathPattern(operation.path).test(observation.path),
    )
  );
}

function isObservation(value: unknown): value is APIObservation {
  return (
    isObject(value) &&
    typeof value.method === "string" &&
    typeof value.path === "string" &&
    typeof value.status === "number" &&
    (value.problemType === undefined || typeof value.problemType === "string")
  );
}

async function readObservations(directory: string): Promise<APIObservation[]> {
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".json"),
  );
  const observations: APIObservation[] = [];
  for (const file of files) {
    const data: unknown = JSON.parse(
      await readFile(join(directory, file), "utf8"),
    );
    const record = requireObject(data, `API coverage file ${file}`);
    if (!Array.isArray(record.observations)) {
      throw new Error(`API coverage file ${file} has no observations array`);
    }
    for (const observation of record.observations) {
      if (!isObservation(observation)) {
        throw new Error(`API coverage file ${file} has an invalid observation`);
      }
      observations.push({
        ...observation,
        method: observation.method.toUpperCase(),
      });
    }
  }
  if (observations.length === 0) {
    throw new Error(`no API observations found in ${directory}`);
  }
  return observations;
}

function percentage(covered: number, total: number): string {
  return total === 0 ? "100.0" : ((100 * covered) / total).toFixed(1);
}

function summaryLine(label: string, covered: number, total: number): string {
  return `  ${label.padEnd(29)} ${percentage(covered, total).padStart(5)}% (${covered}/${total})`;
}

function statusKey(operation: ContractOperation, status: string): string {
  return `${operation.key} ${status}`;
}

function isPlaywrightTestableStatus(status: string): boolean {
  return !PLAYWRIGHT_UNTESTABLE_STATUSES.has(status);
}

function variantKey(
  operation: ContractOperation,
  status: string,
  problemType?: string,
): string {
  return problemType === undefined
    ? statusKey(operation, status)
    : `${statusKey(operation, status)} ${problemType}`;
}

async function main(): Promise<void> {
  const [documentPath, observationsDirectory] = process.argv.slice(2);
  if (documentPath === undefined || observationsDirectory === undefined) {
    throw new Error(
      "usage: api-coverage-report.ts <openapi.json> <observations-directory>",
    );
  }
  const document = requireObject(
    JSON.parse(await readFile(documentPath, "utf8")),
    "OpenAPI document",
  );
  const operations = contractOperations(document);
  const observations = await readObservations(observationsDirectory);

  const coveredOperations = new Set<string>();
  const coveredStatuses = new Set<string>();
  const coveredVariants = new Set<string>();
  const anomalies = new Set<string>();

  for (const observation of observations) {
    const operation = matchingOperation(operations, observation);
    if (operation === undefined) {
      const description = `${observation.method} ${observation.path}`;
      anomalies.add(`undeclared operation ${description}`);
      continue;
    }
    const status = String(observation.status);
    const response = operation.responses.get(status);
    if (response === undefined) {
      anomalies.add(`undeclared response ${operation.key} ${status}`);
      continue;
    }
    if (!isPlaywrightTestableStatus(status)) continue;
    coveredOperations.add(operation.key);
    coveredStatuses.add(statusKey(operation, status));
    if (response.problemTypes.size === 0) {
      coveredVariants.add(variantKey(operation, status));
      continue;
    }
    if (observation.problemType === undefined) {
      anomalies.add(`missing problem type ${operation.key} ${status}`);
      continue;
    }
    if (!response.problemTypes.has(observation.problemType)) {
      anomalies.add(
        `undeclared problem type ${operation.key} ${status} ${observation.problemType}`,
      );
      continue;
    }
    const observedVariant = variantKey(
      operation,
      status,
      observation.problemType,
    );
    if (!PLAYWRIGHT_UNTESTABLE_VARIANTS.has(observedVariant)) {
      coveredVariants.add(observedVariant);
    }
  }

  const declaredStatuses = new Set<string>();
  const declaredVariants = new Set<string>();
  const untestableVariants = new Set<string>();
  let untestableStatusDeclarations = 0;
  const statusGroups = {
    success: new Set<string>(),
    clientError: new Set<string>(),
    serverError: new Set<string>(),
  };
  for (const operation of operations) {
    for (const [status, response] of operation.responses) {
      if (!isPlaywrightTestableStatus(status)) {
        untestableStatusDeclarations += 1;
        continue;
      }
      const key = statusKey(operation, status);
      declaredStatuses.add(key);
      const statusNumber = Number(status);
      if (statusNumber >= 200 && statusNumber < 300) {
        statusGroups.success.add(key);
      } else if (statusNumber >= 400 && statusNumber < 500) {
        statusGroups.clientError.add(key);
      } else if (statusNumber >= 500) {
        statusGroups.serverError.add(key);
      }
      if (response.problemTypes.size === 0) {
        declaredVariants.add(variantKey(operation, status));
      } else {
        for (const type of response.problemTypes) {
          const key = variantKey(operation, status, type);
          if (PLAYWRIGHT_UNTESTABLE_VARIANTS.has(key)) {
            untestableVariants.add(key);
          } else {
            declaredVariants.add(key);
          }
        }
      }
    }
  }
  for (const key of PLAYWRIGHT_UNTESTABLE_VARIANTS) {
    if (!untestableVariants.has(key)) {
      throw new Error(
        `Playwright-untestable response variant is undeclared: ${key}`,
      );
    }
  }

  const coveredInGroup = (group: Set<string>): number =>
    [...group].filter((key) => coveredStatuses.has(key)).length;

  console.log("\nAPI contract coverage");
  console.log(
    summaryLine("Operations", coveredOperations.size, operations.length),
  );
  console.log(
    summaryLine(
      "Testable 2xx statuses",
      coveredInGroup(statusGroups.success),
      statusGroups.success.size,
    ),
  );
  console.log(
    summaryLine(
      "Testable 4xx statuses",
      coveredInGroup(statusGroups.clientError),
      statusGroups.clientError.size,
    ),
  );
  console.log(
    summaryLine(
      "Testable 5xx statuses",
      coveredInGroup(statusGroups.serverError),
      statusGroups.serverError.size,
    ),
  );
  console.log(
    summaryLine(
      "All testable statuses",
      coveredStatuses.size,
      declaredStatuses.size,
    ),
  );
  console.log(
    summaryLine(
      "Testable response variants",
      coveredVariants.size,
      declaredVariants.size,
    ),
  );
  console.log(
    `  ${"Observed responses".padEnd(29)} ${String(observations.length).padStart(12)}`,
  );
  console.log(
    `  ${"Untestable status declarations".padEnd(29)} ${String(untestableStatusDeclarations).padStart(5)} (${[...PLAYWRIGHT_UNTESTABLE_STATUSES].join(", ")})`,
  );

  const missingOperations = operations.filter(
    (operation) => !coveredOperations.has(operation.key),
  );
  if (missingOperations.length > 0) {
    console.log("\nMissing operations:");
    for (const operation of missingOperations) {
      console.log(`  ${operation.key} (${operation.operationID})`);
    }
  }

  const operationsWithMissingStatuses = operations
    .map((operation) => ({
      operation,
      statuses: [...operation.responses.keys()].filter(
        (status) =>
          isPlaywrightTestableStatus(status) &&
          !coveredStatuses.has(statusKey(operation, status)),
      ),
    }))
    .filter(({ statuses }) => statuses.length > 0);
  if (operationsWithMissingStatuses.length > 0) {
    console.log("\nMissing declared statuses:");
    for (const { operation, statuses } of operationsWithMissingStatuses) {
      console.log(`  ${operation.key}: ${statuses.join(", ")}`);
    }
  }

  const variantGaps: string[] = [];
  for (const operation of operations) {
    for (const [status, response] of operation.responses) {
      if (
        response.problemTypes.size === 0 ||
        !coveredStatuses.has(statusKey(operation, status))
      ) {
        continue;
      }
      const missingTypes = [...response.problemTypes].filter((type) => {
        const key = variantKey(operation, status, type);
        return declaredVariants.has(key) && !coveredVariants.has(key);
      });
      if (missingTypes.length > 0) {
        variantGaps.push(
          `  ${operation.key} ${status}: ${missingTypes.join(", ")}`,
        );
      }
    }
  }
  if (variantGaps.length > 0) {
    console.log("\nMissing response variants for covered statuses:");
    for (const gap of variantGaps) console.log(gap);
  }

  if (untestableVariants.size > 0) {
    console.log("\nPlaywright-untestable response variants:");
    for (const variant of [...untestableVariants].sort()) {
      console.log(`  ${variant}`);
    }
  }

  if (anomalies.size > 0) {
    console.error("\nContract mismatches:");
    for (const anomaly of [...anomalies].sort()) {
      console.error(`  ${anomaly}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nContract mismatches: none");
  }
}

await main();
