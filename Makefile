SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := dev

-include .env
export

REGISTRY  ?= ghcr.io/vetchium
TAG       ?= dev
PLATFORMS ?= linux/amd64,linux/arm64
BUILDER   := vetchium
APP_POSTGRES_PASSWORD ?= app_pgpassword
ADMIN_CREDENTIAL_KEY  ?= dev_admin_credential_key
HUB_CREDENTIAL_KEY    ?= dev_hub_credential_key
GLOBAL_COORDINATOR_CREDENTIAL ?= dev_global_coordinator_credential_32_bytes
DEV_SECRETS_DIR       := .dev-secrets
APP_PASSWORD_FILE     := $(DEV_SECRETS_DIR)/app_postgres_password
ADMIN_KEY_FILE        := $(DEV_SECRETS_DIR)/admin_credential_key
HUB_KEY_FILE          := $(DEV_SECRETS_DIR)/hub_credential_key
COORDINATOR_KEY_FILE  := $(DEV_SECRETS_DIR)/global_coordinator_credential
SQLC                   := go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.29.0
GOVULNCHECK             := go run golang.org/x/vuln/cmd/govulncheck@v1.7.0
# The v2.12.2 image was built with Go 1.26 and rejects Go 1.27 modules. Build
# the same pinned release with the project's Go toolchain until upstream ships
# an official Go 1.27-compatible release.
GOLANGCI_LINT           := go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2
SQLFLUFF_IMAGE          := sqlfluff/sqlfluff:4.2.2@sha256:7e8f4f1bc8f70c6ab7da3094c3ca0ff0c66f3d721896d79c3731e549ea1921fb
GO_MODULES             := backend typespec
SQL_DIRS               := backend/internal/db/queries db/bootstrap db/dev-seed \
	db/migrations
GOTESTFLAGS            ?=
COVERAGE_DIR            := $(CURDIR)/.coverage
API_COVERAGE_DIR        := $(COVERAGE_DIR)/api
OPENAPI_DOCUMENT        := $(CURDIR)/typespec/tsp-output/schema/openapi.json
# nproc covers Linux; the sysctl fallback covers macOS.
JOBS ?= $(shell nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
WAIT_TIMEOUT ?= 300

# `docker compose up --wait` with no service arguments waits on every service,
# and it fails outright on any service that has no health state instead of
# settling for "running". The workers are background job loops that serve no
# requests, so they carry no health check and must be excluded from the wait.
# Compose has no per-service opt-out, so the wait set is named explicitly.
serving_services = $$(docker compose -f $(1) config --services | grep -v '^workers-')

.PHONY: check dev dev-secrets sqlc sqlc-vet sqlc-verify sql-lint sql-check \
	test test-dependencies test-environment test-stack test-static-ready \
	test-go test-go-static test-go-lint test-go-vuln coverage-summary \
	admin-ui-deps admin-ui-check admin-ui-check-ready \
	hub-ui-deps hub-ui-check hub-ui-check-ready portal-ui-deps \
	portal-ui-check portal-ui-check-ready typespec-deps \
	typespec-check \
	typespec-check-ready typespec-test playwright-deps playwright-browser \
	playwright-browser-ready playwright-check playwright-check-ready \
	playwright-test playwright-test-run api-coverage-prepare \
	api-coverage-report docker publish clean

dev: clean
	$(MAKE) --no-print-directory dev-secrets
	docker compose -f docker-compose.json up --build -d --remove-orphans
	docker compose -f docker-compose.json up -d --wait \
		--wait-timeout $(WAIT_TIMEOUT) $(call serving_services,docker-compose.json)
	@echo
	@for t in sgp usa1 deu ind1; do \
		for p in orgs hub admin; do echo "  http://$$p-ui.$$t.localhost/"; done; \
	done

dev-secrets:
	@install -d -m 700 "$(DEV_SECRETS_DIR)"
	@if [ -f "$(APP_PASSWORD_FILE)" ]; then \
		current=$$(cat "$(APP_PASSWORD_FILE)"); \
		test "$$current" = "$$APP_POSTGRES_PASSWORD" || \
			{ echo "APP_POSTGRES_PASSWORD differs from the initialized development secret; run make clean before changing it"; exit 1; }; \
	else \
		umask 077; printf '%s' "$$APP_POSTGRES_PASSWORD" > "$(APP_PASSWORD_FILE)"; \
	fi
	@if [ -f "$(ADMIN_KEY_FILE)" ]; then \
		current=$$(cat "$(ADMIN_KEY_FILE)"); \
		test "$$current" = "$$ADMIN_CREDENTIAL_KEY" || \
			{ echo "ADMIN_CREDENTIAL_KEY differs from the initialized development secret; run make clean before changing it"; exit 1; }; \
	else \
		umask 077; printf '%s' "$$ADMIN_CREDENTIAL_KEY" > "$(ADMIN_KEY_FILE)"; \
	fi
	@if [ -f "$(HUB_KEY_FILE)" ]; then \
		current=$$(cat "$(HUB_KEY_FILE)"); \
		test "$$current" = "$$HUB_CREDENTIAL_KEY" || \
			{ echo "HUB_CREDENTIAL_KEY differs from the initialized development secret; run make clean before changing it"; exit 1; }; \
	else \
		umask 077; printf '%s' "$$HUB_CREDENTIAL_KEY" > "$(HUB_KEY_FILE)"; \
	fi
	@if [ -f "$(COORDINATOR_KEY_FILE)" ]; then \
		current=$$(cat "$(COORDINATOR_KEY_FILE)"); \
		test "$$current" = "$$GLOBAL_COORDINATOR_CREDENTIAL" || \
			{ echo "GLOBAL_COORDINATOR_CREDENTIAL differs from the initialized development secret; run make clean before changing it"; exit 1; }; \
	else \
		umask 077; printf '%s' "$$GLOBAL_COORDINATOR_CREDENTIAL" > "$(COORDINATOR_KEY_FILE)"; \
	fi

sqlc:
	cd backend && $(SQLC) generate

sqlc-vet:
	cd backend && $(SQLC) vet

sqlc-verify:
	@set -e; \
	verification_dir=$$(mktemp -d); \
	trap 'rm -rf "$$verification_dir"' EXIT; \
	cp -R backend/internal/db/sqlc/. "$$verification_dir/"; \
	$(MAKE) --no-print-directory sqlc; \
	diff -ru "$$verification_dir" backend/internal/db/sqlc || { \
		echo "generated sqlc code is stale; run 'make sqlc' and commit it"; \
		exit 1; \
	}

# sqlc owns PostgreSQL syntax validation. SQLFluff does not understand every
# PostgreSQL and sqlc construct used here, so it supplies complementary
# structural checks for ambiguous wildcards and unused CTEs.
sql-lint:
	docker run --rm -v "$(CURDIR):/workspace:ro" -w /workspace \
		$(SQLFLUFF_IMAGE) lint --dialect postgres --ignore parsing \
		--rules AM04,ST03 $(SQL_DIRS)

sql-check: sqlc-vet sqlc-verify sql-lint

test: clean
	$(MAKE) --no-print-directory sql-check
	$(MAKE) --no-print-directory -j$(JOBS) test-static-ready playwright-browser-ready
	$(MAKE) --no-print-directory test-stack
	$(MAKE) --no-print-directory playwright-test-run
	$(MAKE) --no-print-directory coverage-summary
	$(MAKE) --no-print-directory api-coverage-report

test-dependencies: admin-ui-deps hub-ui-deps portal-ui-deps typespec-deps \
	playwright-deps

test-static-ready: test-go test-go-static test-go-lint test-go-vuln \
	admin-ui-check-ready hub-ui-check-ready typespec-check-ready \
	portal-ui-check-ready playwright-check-ready

test-environment:
	$(MAKE) --no-print-directory playwright-browser-ready
	$(MAKE) --no-print-directory test-stack

test-stack: dev-secrets
	@attempt=1; \
	until docker compose -f docker-compose-ci.json up --build --force-recreate --remove-orphans -d && \
		docker compose -f docker-compose-ci.json up -d --wait \
		--wait-timeout $(WAIT_TIMEOUT) $(call serving_services,docker-compose-ci.json); do \
		if [ "$$attempt" -ge 3 ]; then \
			echo "CI stack failed after $$attempt attempts"; \
			exit 1; \
		fi; \
		attempt=$$((attempt + 1)); \
		echo "CI stack setup failed; retrying (attempt $$attempt of 3)"; \
		sleep 5; \
	done

# Unit tests for every Go module; no database or running stack needed.
# Race detection is always enabled. Pass extra flags with, for example,
# make test-go GOTESTFLAGS='-count=1'.
test-go: typespec-deps
	@mkdir -p "$(COVERAGE_DIR)"
	@for m in $(GO_MODULES); do \
		echo "==> $$m"; \
		profile="$(COVERAGE_DIR)/$$m.out"; \
		(cd "$$m" && go test -race $(GOTESTFLAGS) -covermode=atomic \
			-coverprofile="$$profile" ./...) || exit $$?; \
	done

test-go-static: typespec-deps
	@unformatted=$$(find $(GO_MODULES) -type f -name '*.go' -print0 | \
		xargs -0 gofmt -l); \
	test -z "$$unformatted" || { \
		echo "Go files require gofmt:"; \
		echo "$$unformatted"; \
		exit 1; \
	}
	@for m in $(GO_MODULES); do \
		echo "==> go vet $$m"; \
		(cd "$$m" && go vet ./...) || exit $$?; \
	done

test-go-lint: typespec-deps
	@for m in $(GO_MODULES); do \
		echo "==> golangci-lint $$m"; \
		(cd "$$m" && $(GOLANGCI_LINT) run) || exit $$?; \
	done

test-go-vuln: typespec-deps
	@for m in $(GO_MODULES); do \
		echo "==> govulncheck $$m"; \
		(cd "$$m" && $(GOVULNCHECK) -test ./...) || exit $$?; \
	done

coverage-summary:
	@for m in $(GO_MODULES); do \
		test -f "$(COVERAGE_DIR)/$$m.out" || { \
			echo "missing coverage profile for $$m"; \
			exit 1; \
		}; \
	done
	@echo
	@for m in $(GO_MODULES); do \
		awk -v module="$$m" 'FNR > 1 { \
			total += $$(NF - 1); \
			if ($$NF > 0) covered += $$(NF - 1); \
		} END { \
			printf "  %-12s %5.1f%% (%d/%d statements)\n", \
				module, 100 * covered / total, covered, total; \
		}' "$(COVERAGE_DIR)/$$m.out"; \
	done
	@awk 'FNR > 1 { \
		total += $$(NF - 1); \
		if ($$NF > 0) covered += $$(NF - 1); \
	} END { \
		printf "  %-12s %5.1f%% (%d/%d statements)\n", "all Go", \
			100 * covered / total, covered, total; \
	}' $(foreach m,$(GO_MODULES),"$(COVERAGE_DIR)/$(m).out")

# `check` remains an alias for the complete repository test suite.
check: test

admin-ui-deps:
	cd admin-ui && npm ci

admin-ui-check-ready: admin-ui-deps
	cd admin-ui && npm run format:check
	cd admin-ui && npm run typecheck
	cd admin-ui && npm audit --audit-level=high
	cd admin-ui && npm run build

admin-ui-check: admin-ui-check-ready

hub-ui-deps:
	cd hub-ui && npm ci

hub-ui-check-ready: hub-ui-deps
	cd hub-ui && npm run format:check
	cd hub-ui && npm run typecheck
	cd hub-ui && npm audit --audit-level=high
	cd hub-ui && npm run build

hub-ui-check: hub-ui-check-ready

portal-ui-deps:
	cd portal-ui && npm ci

portal-ui-check-ready: portal-ui-deps
	cd portal-ui && npm run format:check
	cd portal-ui && npm run typecheck
	cd portal-ui && npm audit --audit-level=high

portal-ui-check: portal-ui-check-ready

typespec-deps:
	cd typespec && npm ci

typespec-check-ready: typespec-deps
	cd typespec && npm run check:contract-files
	cd typespec && npm run test:contract-files
	cd typespec && npm run format:check
	cd typespec && npm run typecheck
	cd typespec && npm run test:ts
	cd typespec && npm audit --audit-level=high
	cd typespec && npm run compile

typespec-check: typespec-check-ready

typespec-test: typespec-check

playwright-deps:
	cd playwright && npm ci

playwright-browser: playwright-browser-ready

playwright-browser-ready: playwright-deps
	cd playwright && npx playwright install chromium

playwright-check-ready: playwright-deps
	cd playwright && npm run format:check
	cd playwright && npm run typecheck
	cd playwright && npm run test:coverage-api
	cd playwright && npm audit --audit-level=high

playwright-check: playwright-check-ready

api-coverage-prepare:
	rm -rf "$(API_COVERAGE_DIR)"
	mkdir -p "$(API_COVERAGE_DIR)"

playwright-test-run:
	$(MAKE) --no-print-directory api-coverage-prepare
	cd playwright && API_COVERAGE_DIR="$(API_COVERAGE_DIR)" npm test

api-coverage-report:
	@test -f "$(OPENAPI_DOCUMENT)" || { \
		echo "missing OpenAPI document: $(OPENAPI_DOCUMENT)"; \
		exit 1; \
	}
	cd playwright && npm run coverage:api -- \
		"$(OPENAPI_DOCUMENT)" "$(API_COVERAGE_DIR)"

playwright-test:
	$(MAKE) --no-print-directory -j$(JOBS) playwright-check-ready \
		playwright-browser-ready typespec-check-ready
	$(MAKE) --no-print-directory test-stack
	$(MAKE) --no-print-directory playwright-test-run
	$(MAKE) --no-print-directory api-coverage-report

# Build validation; keep results only in BuildKit's cache.
docker:
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || \
		docker buildx create --name $(BUILDER) --driver docker-container --bootstrap >/dev/null
	REGISTRY=$(REGISTRY) TAG=$(TAG) docker buildx bake --builder $(BUILDER) -f docker-bake.hcl \
		--set '*.output=type=cacheonly'

publish:
	@case "$(TAG)" in dev|latest) echo "set TAG to an immutable tag, e.g. TAG=v1.2.3"; exit 1;; esac
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || \
		docker buildx create --name $(BUILDER) --driver docker-container --bootstrap >/dev/null
	REGISTRY=$(REGISTRY) TAG=$(TAG) PLATFORMS=$(PLATFORMS) \
		docker buildx bake --builder $(BUILDER) -f docker-bake.hcl --push

clean:
	docker compose -f docker-compose.json down --remove-orphans --volumes
	rm -f "$(APP_PASSWORD_FILE)" "$(ADMIN_KEY_FILE)" "$(HUB_KEY_FILE)" \
		"$(COORDINATOR_KEY_FILE)"
	-rmdir "$(DEV_SECRETS_DIR)"
	rm -rf "$(COVERAGE_DIR)"
