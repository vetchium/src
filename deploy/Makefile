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
MESH_API_PORT ?= 8443
PGSSLMODE ?= disable
WIREGUARD_INTERFACE ?= wg0
MESH_CA_SECRET_NAME ?= vetchium_mesh_ca_certificate
GLOBAL_COORDINATOR_TLS_CERTIFICATE_SECRET_NAME ?= global_coordinator_tls_certificate
GLOBAL_COORDINATOR_TLS_KEY_SECRET_NAME ?= global_coordinator_tls_key
GLOBAL_COORDINATOR_HEALTH_CERTIFICATE_SECRET_NAME ?= global_coordinator_health_certificate
GLOBAL_COORDINATOR_HEALTH_KEY_SECRET_NAME ?= global_coordinator_health_key
MESH_CLIENT_CERTIFICATE_SECRET_NAME ?= $(REGION)_mesh_client_certificate
MESH_CLIENT_KEY_SECRET_NAME ?= $(REGION)_mesh_client_key
MESH_SERVER_CERTIFICATE_SECRET_NAME ?= $(REGION)_mesh_server_certificate
MESH_SERVER_KEY_SECRET_NAME ?= $(REGION)_mesh_server_key

.PHONY: deploy deploy-global-coordinator

deploy-global-coordinator:
	@test -n "$(TAG)" || { echo "TAG is required, e.g. TAG=v1.2.3"; exit 1; }
	@test -n "$(GLOBAL_POSTGRES_USER)" || { echo "GLOBAL_POSTGRES_USER is required"; exit 1; }
	@test -n "$(GLOBAL_POSTGRES_DB)" || { echo "GLOBAL_POSTGRES_DB is required"; exit 1; }
	@test -n "$(GLOBAL_COORDINATOR_WIREGUARD_IP)" || { echo "GLOBAL_COORDINATOR_WIREGUARD_IP is required"; exit 1; }
	@case "$(WIREGUARD_INTERFACE)" in *[!A-Za-z0-9_.-]*|'') echo "WIREGUARD_INTERFACE is invalid"; exit 1;; esac
	@ip link show dev "$(WIREGUARD_INTERFACE)" >/dev/null 2>&1 || \
		{ echo "WireGuard interface $(WIREGUARD_INTERFACE) does not exist"; exit 1; }
	@ip -o addr show dev "$(WIREGUARD_INTERFACE)" | \
		grep -Fq " $(GLOBAL_COORDINATOR_WIREGUARD_IP)/" || \
		{ echo "GLOBAL_COORDINATOR_WIREGUARD_IP is not assigned to $(WIREGUARD_INTERFACE)"; exit 1; }
	@case "$(TAG)" in dev|latest) echo "refusing floating tag $(TAG)"; exit 1;; esac
	@docker info --format '{{.Swarm.LocalNodeState}}' | grep -qx active || docker swarm init >/dev/null
	@docker info --format '{{.Swarm.ControlAvailable}}' | grep -qx true || \
		{ echo "this host is a swarm worker, not a manager"; exit 1; }
	@for secret in "$(MESH_CA_SECRET_NAME)" \
		"$(GLOBAL_COORDINATOR_TLS_CERTIFICATE_SECRET_NAME)" \
		"$(GLOBAL_COORDINATOR_TLS_KEY_SECRET_NAME)" \
		"$(GLOBAL_COORDINATOR_HEALTH_CERTIFICATE_SECRET_NAME)" \
		"$(GLOBAL_COORDINATOR_HEALTH_KEY_SECRET_NAME)"; do \
		docker secret inspect "$$secret" >/dev/null 2>&1 || \
			{ echo "required mesh TLS secret $$secret does not exist"; exit 1; }; \
	done
	@set -e; \
	admin_secret=global_postgres_password; \
	app_secret=global_app_postgres_password; \
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
		cid=$$(docker ps -q --filter "label=com.docker.swarm.service.name=global-coordinator_db" | head -1); \
		test -n "$$cid" || { echo "cannot derive $$app_secret: no running global database task"; exit 1; }; \
		pw=$$(docker exec "$$cid" cat /run/secrets/global_postgres_password); \
		app_pw=$$(printf 'vetchium_app:%s' "$$pw" | sha256sum | cut -d ' ' -f1); \
		printf '%s' "$$app_pw" | docker secret create "$$app_secret" - >/dev/null; \
	fi
	@config_hash=$$(sha256sum global-coordinator/config.json | cut -c1-12); \
	signup_regions_hash=$$(sha256sum signup-regions.json | cut -c1-12); \
	deploy_stack() { \
		GLOBAL_COORDINATOR_CONFIG_HASH=$$config_hash REGISTRY=$(REGISTRY) TAG=$(TAG) \
			SIGNUP_REGIONS_HASH=$$signup_regions_hash \
			GLOBAL_COORDINATOR_PORT=$(GLOBAL_COORDINATOR_PORT) \
			GLOBAL_POSTGRES_USER=$(GLOBAL_POSTGRES_USER) \
			GLOBAL_POSTGRES_DB=$(GLOBAL_POSTGRES_DB) PGSSLMODE=$(PGSSLMODE) \
			docker stack deploy --compose-file global-coordinator/stack.json \
			--with-registry-auth --prune --detach=false global-coordinator; \
	}; \
	db_task() { docker ps -q --filter "label=com.docker.swarm.service.name=global-coordinator_db" | head -1; }; \
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
	migrate() { \
		cid=$$(db_task); \
		test -n "$$cid" || { echo "no running global database task"; exit 1; }; \
		pw=$$(docker exec "$$cid" cat /run/secrets/global_postgres_password); \
		uri_user=$$(uri_encode "$(GLOBAL_POSTGRES_USER)"); \
		uri_pw=$$(uri_encode "$$pw"); \
		uri_db=$$(uri_encode "$(GLOBAL_POSTGRES_DB)"); \
		uri_sslmode=$$(uri_encode "$(PGSSLMODE)"); \
		f=$$(mktemp); chmod 600 "$$f"; \
		printf 'GOOSE_DBSTRING=postgres://%s:%s@db:5432/%s?sslmode=%s\n' \
			"$$uri_user" "$$uri_pw" "$$uri_db" "$$uri_sslmode" > "$$f"; \
		if docker run --rm --network global-coordinator_backend --env-file "$$f" \
				$(REGISTRY)/global-migrate:$(TAG) up; then rm -f "$$f"; else \
			rm -f "$$f"; \
			echo "global migration failed; the stack was not updated"; \
			exit 1; \
		fi; \
	}; \
	if docker stack ls --format '{{.Name}}' | grep -qx global-coordinator && \
		[ -n "$$(db_task)" ]; then \
		migrate; deploy_stack; \
	else \
		deploy_stack; \
		for i in $$(seq 1 90); do \
			cid=$$(db_task); \
			if [ -n "$$cid" ] && docker exec "$$cid" pg_isready -U $(GLOBAL_POSTGRES_USER) -d $(GLOBAL_POSTGRES_DB) >/dev/null 2>&1; then break; fi; \
			sleep 2; \
			done; \
		migrate; \
		deploy_stack; \
	fi
	@echo "global-coordinator is running $(TAG)"

deploy:
	@test -n "$(REGION)" || { echo "REGION is required, e.g. REGION=sgp"; exit 1; }
	@test -d "$(REGION)" || { echo "no such region: $(REGION)"; exit 1; }
	@test -n "$(TAG)" || { echo "TAG is required, e.g. TAG=v1.2.3"; exit 1; }
	@test -n "$(POSTGRES_USER)" || { echo "POSTGRES_USER is required"; exit 1; }
	@test -n "$(POSTGRES_DB)" || { echo "POSTGRES_DB is required"; exit 1; }
	@test -n "$(GLOBAL_COORDINATOR_WIREGUARD_IP)" || { echo "GLOBAL_COORDINATOR_WIREGUARD_IP is required"; exit 1; }
	@test -n "$(MESH_API_WIREGUARD_IP)" || { echo "MESH_API_WIREGUARD_IP is required"; exit 1; }
	@case "$(WIREGUARD_INTERFACE)" in *[!A-Za-z0-9_.-]*|'') echo "WIREGUARD_INTERFACE is invalid"; exit 1;; esac
	@ip link show dev "$(WIREGUARD_INTERFACE)" >/dev/null 2>&1 || \
		{ echo "WireGuard interface $(WIREGUARD_INTERFACE) does not exist"; exit 1; }
	@ip route get "$(GLOBAL_COORDINATOR_WIREGUARD_IP)" | \
		grep -Eq "dev $(WIREGUARD_INTERFACE)( |$$)" || \
		{ echo "global coordinator route does not use $(WIREGUARD_INTERFACE)"; exit 1; }
	@getent ahosts global-coordinator.internal | awk '{print $$1}' | \
		grep -Fxq "$(GLOBAL_COORDINATOR_WIREGUARD_IP)" || \
		{ echo "global-coordinator.internal does not resolve to GLOBAL_COORDINATOR_WIREGUARD_IP"; exit 1; }
	@ip -o addr show dev "$(WIREGUARD_INTERFACE)" | \
		grep -Fq " $(MESH_API_WIREGUARD_IP)/" || \
		{ echo "MESH_API_WIREGUARD_IP is not assigned to $(WIREGUARD_INTERFACE)"; exit 1; }
	@getent ahosts "$(REGION).mesh.vetchium.com" | awk '{print $$1}' | \
		grep -Fxq "$(MESH_API_WIREGUARD_IP)" || \
		{ echo "$(REGION).mesh.vetchium.com does not resolve to MESH_API_WIREGUARD_IP"; exit 1; }
	@case "$(TAG)" in dev|latest) echo "refusing floating tag $(TAG)"; exit 1;; esac

	@docker info --format '{{.Swarm.LocalNodeState}}' | grep -qx active || docker swarm init >/dev/null
	@docker info --format '{{.Swarm.ControlAvailable}}' | grep -qx true || \
		{ echo "this host is a swarm worker, not a manager"; exit 1; }
	@for secret in "$(MESH_CA_SECRET_NAME)" \
		"$(MESH_CLIENT_CERTIFICATE_SECRET_NAME)" \
		"$(MESH_CLIENT_KEY_SECRET_NAME)" \
		"$(MESH_SERVER_CERTIFICATE_SECRET_NAME)" \
		"$(MESH_SERVER_KEY_SECRET_NAME)"; do \
		docker secret inspect "$$secret" >/dev/null 2>&1 || \
			{ echo "required mesh TLS secret $$secret does not exist"; exit 1; }; \
	done

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
	@if ! docker secret inspect "$(REGION)_admin_credential_key" >/dev/null 2>&1; then \
		credential_key=$$(openssl rand -hex 32); \
		printf '%s' "$$credential_key" | \
			docker secret create "$(REGION)_admin_credential_key" - >/dev/null; \
	fi
	@if ! docker secret inspect "$(REGION)_orgs_credential_key" >/dev/null 2>&1; then \
		credential_key=$$(openssl rand -hex 32); \
		printf '%s' "$$credential_key" | \
			docker secret create "$(REGION)_orgs_credential_key" - >/dev/null; \
	fi
	@if ! docker secret inspect "$(REGION)_mesh_credential" >/dev/null 2>&1; then \
		printf '%s' "$$(openssl rand -hex 32)" | \
			docker secret create "$(REGION)_mesh_credential" - >/dev/null; \
	fi
	@set -e; \
	config_secret=$(REGION)_seaweed_s3_config; \
	access_secret=$(REGION)_seaweed_s3_access_key; \
	secret_secret=$(REGION)_seaweed_s3_secret_key; \
	count=0; \
	for name in "$$config_secret" "$$access_secret" "$$secret_secret"; do \
		if docker secret inspect "$$name" >/dev/null 2>&1; then count=$$((count + 1)); fi; \
	done; \
	if [ "$$count" -ne 0 ] && [ "$$count" -ne 3 ]; then \
		echo "incomplete $(REGION) SeaweedFS S3 secrets; refusing deployment"; \
		exit 1; \
	fi; \
	if [ "$$count" -eq 0 ]; then \
		access_key=$$(openssl rand -hex 16); \
		secret_key=$$(openssl rand -hex 32); \
		printf '%s' "$$access_key" | docker secret create "$$access_secret" - >/dev/null; \
		printf '%s' "$$secret_key" | docker secret create "$$secret_secret" - >/dev/null; \
		printf '{"identities":[{"name":"vetchium-hub-media","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin:hub-profile-pictures","Read:hub-profile-pictures","List:hub-profile-pictures","Write:hub-profile-pictures"]}]}' \
			"$$access_key" "$$secret_key" | \
			docker secret create "$$config_secret" - >/dev/null; \
	fi

	@set -e; \
	traefik_hash=$$(sha256sum $(REGION)/traefik.json | cut -c1-12); \
	app_config_hash=$$(sha256sum $(REGION)/config.json | cut -c1-12); \
	signup_regions_hash=$$(sha256sum signup-regions.json | cut -c1-12); \
	seaweed_s3_entrypoint_hash=$$(sha256sum ../dev/seaweedfs-s3-entrypoint.sh | cut -c1-12); \
	media_proxy_hash=$$(sha256sum ../media/nginx.conf | cut -c1-12); \
	deploy_stack() { \
		TRAEFIK_HASH=$$traefik_hash APP_CONFIG_HASH=$$app_config_hash \
		SIGNUP_REGIONS_HASH=$$signup_regions_hash \
		SEAWEED_S3_ENTRYPOINT_HASH=$$seaweed_s3_entrypoint_hash \
		MEDIA_PROXY_HASH=$$media_proxy_hash \
		REGISTRY=$(REGISTRY) TAG=$(TAG) PGSSLMODE=$(PGSSLMODE) \
		POSTGRES_USER=$(POSTGRES_USER) POSTGRES_DB=$(POSTGRES_DB) \
		docker stack deploy --compose-file $(REGION)/stack.json --with-registry-auth \
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
	migrate() { \
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
