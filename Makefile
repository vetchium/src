SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := dev

REGISTRY  ?= ghcr.io/vetchium
TAG       ?= dev
PLATFORMS ?= linux/amd64,linux/arm64
comma := ,
LOCAL_PLATFORM := $(word 1,$(subst $(comma), ,$(PLATFORMS)))
BUILDER   := vetchium
BACKEND_IMAGES := portal-api mesh-api mcp-server worker
OTHER_IMAGES   := migrate:migrations orgs-ui:orgs-ui hub-ui:hub-ui admin-ui:admin-ui

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
	@for image in $(BACKEND_IMAGES); do \
		docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load \
			--target $$image -t $(REGISTRY)/$$image:$(TAG) backend; \
	done
	@for spec in $(OTHER_IMAGES); do \
		docker buildx build --builder $(BUILDER) --platform $(LOCAL_PLATFORM) --load \
			-t $(REGISTRY)/$${spec%%:*}:$(TAG) $${spec##*:}; \
	done

publish:
	@case "$(TAG)" in dev|latest) echo "set TAG to an immutable tag, e.g. TAG=v1.2.3"; exit 1;; esac
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || \
		docker buildx create --name $(BUILDER) --driver docker-container --bootstrap >/dev/null
	@for image in $(BACKEND_IMAGES); do \
		docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push \
			--target $$image -t $(REGISTRY)/$$image:$(TAG) backend; \
	done
	@for spec in $(OTHER_IMAGES); do \
		docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push \
			-t $(REGISTRY)/$${spec%%:*}:$(TAG) $${spec##*:}; \
	done

clean:
	docker compose down --remove-orphans --volumes
	rm -rf .pgdata
