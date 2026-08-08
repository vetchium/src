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
DEV_SECRETS_DIR       := .dev-secrets
APP_PASSWORD_FILE     := $(DEV_SECRETS_DIR)/app_postgres_password
SQLC                   := go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.29.0
GO_MODULES             := backend typespec
GOTESTFLAGS            ?=

.PHONY: check dev dev-secrets sqlc sqlc-verify test test-dependencies \
	test-environment test-stack test-static-ready test-go typespec-deps \
	typespec-check \
	typespec-check-ready typespec-test playwright-deps playwright-browser \
	playwright-browser-ready playwright-check playwright-check-ready \
	playwright-test playwright-test-run docker publish clean

dev: dev-secrets
	docker compose -f docker-compose.json up --build -d --wait
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

sqlc:
	cd backend && $(SQLC) generate

sqlc-verify: sqlc
	@test -z "$$(git status --porcelain -- backend/internal/db/sqlc)" || { \
		git status --short -- backend/internal/db/sqlc; \
		echo "generated sqlc code is stale; run 'make sqlc' and commit it"; \
		exit 1; \
	}

# Install dependencies and fail fast on every server-independent check before
# spending time rebuilding the CI stack. Recipe steps preserve this ordering
# even when the caller enables parallel Make execution.
test:
	$(MAKE) --no-print-directory test-dependencies
	$(MAKE) --no-print-directory test-static-ready
	$(MAKE) --no-print-directory playwright-browser-ready
	$(MAKE) --no-print-directory test-stack
	$(MAKE) --no-print-directory playwright-test-run

test-dependencies: typespec-deps playwright-deps

test-static-ready: test-go typespec-check-ready playwright-check-ready

test-environment:
	$(MAKE) --no-print-directory playwright-deps
	$(MAKE) --no-print-directory playwright-browser-ready
	$(MAKE) --no-print-directory test-stack

test-stack: dev-secrets
	@attempt=1; \
	until docker compose -f docker-compose-ci.json up --build \
		--force-recreate --remove-orphans -d --wait; do \
		if [ "$$attempt" -ge 3 ]; then \
			echo "CI stack failed after $$attempt attempts"; \
			exit 1; \
		fi; \
		attempt=$$((attempt + 1)); \
		echo "CI stack setup failed; retrying (attempt $$attempt of 3)"; \
		sleep 5; \
	done

# Unit tests for every Go module; no database or running stack needed.
# Pass extra flags with e.g. make test-go GOTESTFLAGS='-race -count=1'.
test-go:
	@for m in $(GO_MODULES); do \
		echo "==> $$m"; \
		(cd "$$m" && go test $(GOTESTFLAGS) ./...); \
	done

# `check` remains an alias for the complete repository test suite.
check: test

typespec-deps:
	cd typespec && npm ci

typespec-check-ready:
	cd typespec && npm run check:contract-files
	cd typespec && npm run format:check
	cd typespec && npm run typecheck
	cd typespec && npm run test:ts
	cd typespec && npm run compile

typespec-check: typespec-deps typespec-check-ready

typespec-test: typespec-check

playwright-deps:
	cd playwright && npm ci

playwright-browser: playwright-deps playwright-browser-ready

playwright-browser-ready:
	cd playwright && npx playwright install chromium

playwright-check-ready:
	cd playwright && npm run format:check
	cd playwright && npm run typecheck

playwright-check: playwright-deps playwright-check-ready

playwright-test-run:
	cd playwright && npm test

playwright-test:
	$(MAKE) --no-print-directory playwright-deps
	$(MAKE) --no-print-directory playwright-check-ready
	$(MAKE) --no-print-directory playwright-browser-ready
	$(MAKE) --no-print-directory test-stack
	$(MAKE) --no-print-directory playwright-test-run

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
	rm -f "$(APP_PASSWORD_FILE)"
	-rmdir "$(DEV_SECRETS_DIR)"
