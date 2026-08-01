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

.PHONY: dev dev-secrets docker publish clean

dev: dev-secrets
	docker compose up --build -d --wait
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

# Build validation for CI; keep results only in BuildKit's cache.
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
	docker compose down --remove-orphans --volumes
	rm -f "$(APP_PASSWORD_FILE)"
	-rmdir "$(DEV_SECRETS_DIR)"
