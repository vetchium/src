SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := deploy

ifneq ($(shell uname -s),Linux)
$(error deploy runs on the Linux server only)
endif

-include .env
export

REGISTRY  ?= ghcr.io/vetchium
HTTP_PORT ?= 80

.PHONY: deploy

deploy:
	@test -n "$(REGION)" || { echo "REGION is required, e.g. REGION=sgp"; exit 1; }
	@test -d "$(REGION)" || { echo "no such region: $(REGION)"; exit 1; }
	@test -n "$(TAG)" || { echo "TAG is required, e.g. TAG=v1.2.3"; exit 1; }
	@test -n "$(POSTGRES_USER)" || { echo "POSTGRES_USER is required"; exit 1; }
	@test -n "$(POSTGRES_DB)" || { echo "POSTGRES_DB is required"; exit 1; }
	@case "$(TAG)" in dev|latest) echo "refusing floating tag $(TAG)"; exit 1;; esac

	@docker info --format '{{.Swarm.LocalNodeState}}' | grep -qx active || docker swarm init >/dev/null
	@docker info --format '{{.Swarm.ControlAvailable}}' | grep -qx true || \
		{ echo "this host is a swarm worker, not a manager"; exit 1; }

	@docker secret inspect $(REGION)_postgres_password >/dev/null 2>&1 || \
		openssl rand -base64 32 | tr -d '\n' | \
		docker secret create $(REGION)_postgres_password - >/dev/null

	@set -e; \
	hash=$$(sha256sum $(REGION)/traefik.yml | cut -c1-12); \
	deploy_stack() { \
		TRAEFIK_HASH=$$hash REGISTRY=$(REGISTRY) TAG=$(TAG) \
		POSTGRES_USER=$(POSTGRES_USER) POSTGRES_DB=$(POSTGRES_DB) \
		docker stack deploy --compose-file $(REGION)/stack.yml --with-registry-auth \
			--prune --detach=false $(REGION); \
	}; \
	db_task() { docker ps -q --filter "label=com.docker.swarm.service.name=$(REGION)_db" | head -1; }; \
	migrate() { \
		cid=$$(db_task); \
		test -n "$$cid" || { echo "no running database task"; exit 1; }; \
		pw=$$(docker exec "$$cid" cat /run/secrets/postgres_password); \
		f=$$(mktemp); chmod 600 "$$f"; \
		printf 'GOOSE_DBSTRING=postgres://%s:%s@db:5432/%s?sslmode=disable\n' \
			"$(POSTGRES_USER)" "$$pw" "$(POSTGRES_DB)" > "$$f"; \
		if docker run --rm --network $(REGION)_backend --env-file "$$f" \
				$(REGISTRY)/migrate:$(TAG) up; then rm -f "$$f"; else \
			rm -f "$$f"; \
			echo "migration failed; the stack was not touched and is still serving"; \
			exit 1; \
		fi; \
	}; \
	if docker stack ls --format '{{.Name}}' | grep -qx $(REGION); then \
		migrate; deploy_stack; \
	else \
		deploy_stack; \
		for i in $$(seq 1 90); do \
			cid=$$(db_task); \
			if [ -n "$$cid" ] && docker exec "$$cid" pg_isready -U $(POSTGRES_USER) -d $(POSTGRES_DB) >/dev/null 2>&1; then break; fi; \
			sleep 2; \
		done; \
		migrate; \
	fi
	@echo "$(REGION) is running $(TAG)"
