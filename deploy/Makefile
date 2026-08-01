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
PGSSLMODE ?= disable

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

	@set -e; \
	admin_secret=$(REGION)_postgres_password; \
	app_secret=$(REGION)_app_postgres_password; \
	if ! docker secret inspect "$$admin_secret" >/dev/null 2>&1; then \
		if docker secret inspect "$$app_secret" >/dev/null 2>&1; then \
			echo "$$app_secret exists without $$admin_secret; refusing inconsistent credentials"; \
			exit 1; \
		fi; \
		pw=$$(openssl rand -hex 32); \
		printf '%s' "$$pw" | docker secret create "$$admin_secret" - >/dev/null; \
		app_pw=$$(printf 'vetchium_app:%s' "$$pw" | sha256sum | cut -d ' ' -f1); \
		printf '%s' "$$app_pw" | docker secret create "$$app_secret" - >/dev/null; \
	elif ! docker secret inspect "$$app_secret" >/dev/null 2>&1; then \
		cid=$$(docker ps -q --filter "label=com.docker.swarm.service.name=$(REGION)_db" | head -1); \
		test -n "$$cid" || { echo "cannot derive $$app_secret: no running database task"; exit 1; }; \
		pw=$$(docker exec "$$cid" cat /run/secrets/postgres_password); \
		app_pw=$$(printf 'vetchium_app:%s' "$$pw" | sha256sum | cut -d ' ' -f1); \
		printf '%s' "$$app_pw" | docker secret create "$$app_secret" - >/dev/null; \
	fi

	@set -e; \
	hash=$$(sha256sum $(REGION)/traefik.yml | cut -c1-12); \
	deploy_stack() { \
		TRAEFIK_HASH=$$hash REGISTRY=$(REGISTRY) TAG=$(TAG) PGSSLMODE=$(PGSSLMODE) \
		POSTGRES_USER=$(POSTGRES_USER) POSTGRES_DB=$(POSTGRES_DB) \
		docker stack deploy --compose-file $(REGION)/stack.yml --with-registry-auth \
			--prune --detach=false $(REGION); \
	}; \
	db_task() { docker ps -q --filter "label=com.docker.swarm.service.name=$(REGION)_db" | head -1; }; \
	uri_encode() { \
		local value=$$1 encoded= char hex i; \
		LC_ALL=C; \
		for ((i=0; i<$${#value}; i++)); do \
			char=$${value:i:1}; \
			case "$$char" in \
				[a-zA-Z0-9.~_-]) encoded="$$encoded$$char" ;; \
				*) printf -v hex '%02X' "'$$char"; encoded="$$encoded%$$hex" ;; \
			esac; \
		done; \
		printf '%s' "$$encoded"; \
	}; \
	update_database() { \
		cid=$$(db_task); \
		test -n "$$cid" || { echo "no running database task"; exit 1; }; \
		pw=$$(docker exec "$$cid" cat /run/secrets/postgres_password); \
		uri_user=$$(uri_encode "$(POSTGRES_USER)"); \
		uri_pw=$$(uri_encode "$$pw"); \
		uri_db=$$(uri_encode "$(POSTGRES_DB)"); \
		uri_sslmode=$$(uri_encode "$(PGSSLMODE)"); \
		f=$$(mktemp); chmod 600 "$$f"; \
		printf 'GOOSE_DBSTRING=postgres://%s:%s@db:5432/%s?sslmode=%s\n' \
			"$$uri_user" "$$uri_pw" "$$uri_db" "$$uri_sslmode" > "$$f"; \
		if docker run --rm --network $(REGION)_backend --env-file "$$f" \
				$(REGISTRY)/migrate:$(TAG) up; then rm -f "$$f"; else \
			rm -f "$$f"; \
			echo "migration failed; the stack was not touched and is still serving"; \
			exit 1; \
		fi; \
		if docker exec "$$cid" test -r /run/secrets/app_postgres_password; then \
			app_pw=$$(docker exec "$$cid" cat /run/secrets/app_postgres_password); \
		else \
			app_pw=$$(printf 'vetchium_app:%s' "$$pw" | sha256sum | cut -d ' ' -f1); \
		fi; \
		docker exec -i -e APP_POSTGRES_PASSWORD="$$app_pw" "$$cid" \
			psql --no-password -U "$(POSTGRES_USER)" -d "$(POSTGRES_DB)" \
			-v ON_ERROR_STOP=1 -f - < ../database/post-install.sql; \
	}; \
	if docker stack ls --format '{{.Name}}' | grep -qx $(REGION); then \
		update_database; deploy_stack; \
	else \
		deploy_stack; \
		for i in $$(seq 1 90); do \
			cid=$$(db_task); \
			if [ -n "$$cid" ] && docker exec "$$cid" pg_isready -U $(POSTGRES_USER) -d $(POSTGRES_DB) >/dev/null 2>&1; then break; fi; \
			sleep 2; \
		done; \
		update_database; \
	fi
	@echo "$(REGION) is running $(TAG)"
