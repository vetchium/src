SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := dev

REGISTRY  ?= ghcr.io/vetchium
TAG       ?= dev
PLATFORMS ?= linux/amd64,linux/arm64
comma := ,
LOCAL_PLATFORM := $(word 1,$(subst $(comma), ,$(PLATFORMS)))
BUILDER   := vetchium

.PHONY: dev docker publish clean

dev:
	docker compose up --build -d --wait
	@echo
	@for t in sgp usa1 deu ind1; do \
		for p in orgs hub admin; do echo "  http://$$p-ui.$$t.localhost/"; done; \
	done

docker:
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || \
		docker buildx create --name $(BUILDER) --driver docker-container --bootstrap >/dev/null
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load --target admin-api -t $(REGISTRY)/admin-api:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load --target hub-api -t $(REGISTRY)/hub-api:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load --target orgs-api -t $(REGISTRY)/orgs-api:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load --target mesh-api -t $(REGISTRY)/mesh-api:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load --target mcp-server -t $(REGISTRY)/mcp-server:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load --target worker -t $(REGISTRY)/worker:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load -t $(REGISTRY)/migrate:$(TAG) migrations
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load -t $(REGISTRY)/orgs-ui:$(TAG) orgs-ui
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load -t $(REGISTRY)/hub-ui:$(TAG) hub-ui
	docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load -t $(REGISTRY)/admin-ui:$(TAG) admin-ui

publish:
	@case "$(TAG)" in dev|latest) echo "set TAG to an immutable tag, e.g. TAG=v1.2.3"; exit 1;; esac
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || \
		docker buildx create --name $(BUILDER) --driver docker-container --bootstrap >/dev/null
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push --target admin-api -t $(REGISTRY)/admin-api:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push --target hub-api -t $(REGISTRY)/hub-api:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push --target orgs-api -t $(REGISTRY)/orgs-api:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push --target mesh-api -t $(REGISTRY)/mesh-api:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push --target mcp-server -t $(REGISTRY)/mcp-server:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push --target worker -t $(REGISTRY)/worker:$(TAG) backend
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push -t $(REGISTRY)/migrate:$(TAG) migrations
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push -t $(REGISTRY)/orgs-ui:$(TAG) orgs-ui
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push -t $(REGISTRY)/hub-ui:$(TAG) hub-ui
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push -t $(REGISTRY)/admin-ui:$(TAG) admin-ui

clean:
	docker compose down --remove-orphans --volumes
	rm -rf .pgdata
