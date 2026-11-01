SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := up

-include .env
export

REGISTRY ?= ghcr.io/vetchium
# `make publish` moves latest to its images; TAG=<tag> picks an earlier publish.
TAG ?= latest
ADMIN_UI_DEFAULT_LANGUAGE ?= en-US
TENANTS := sgp usa1 deu ind1
SECRETS := .secrets
STATE := .state
WAIT_TIMEOUT := 300

WG_ADDRESS_global-coordinator := 10.242.0.1
WG_ADDRESS_sgp := 10.242.0.11
WG_ADDRESS_usa1 := 10.242.0.12
WG_ADDRESS_deu := 10.242.0.13
WG_ADDRESS_ind1 := 10.242.0.14
# Region <n>'s networks take 10.<octet>.<n>0.0/24 to 10.<octet>.<n>6.0/24 and
# the global project's 10.<octet>.1.0/24 to 10.<octet>.5.0/24, where <octet> is
# VETCHIUM_STAGING_NETWORK_OCTET (default 232, apart from the development and
# CI stacks' 231).
REGION_NETWORK_sgp := 1
REGION_NETWORK_usa1 := 2
REGION_NETWORK_deu := 3
REGION_NETWORK_ind1 := 4
wg_peers = $(strip $(foreach node,$(filter-out $(1),global-coordinator $(TENANTS)),\
	/run/secrets/wireguard_$(node)_public_key=$(WG_ADDRESS_$(node))=wg-$(node)))

global_compose := docker compose --project-name vetchium-staging --file compose.json
region_compose = REGION=$(1) REGION_NETWORK=$(REGION_NETWORK_$(1)) \
	WIREGUARD_ADDRESS=$(WG_ADDRESS_$(1)) \
	WIREGUARD_PEERS="$(call wg_peers,$(1))" \
	docker compose --project-name vetchium-staging-$(1) --file region.json

# pgcrypto bcrypt-hashes the region's admin password in the maintenance
# database, so tenant_db keeps exactly the schema the migrations made;
# credentials.ComparePassword accepts a plain bcrypt hash. The password travels
# over stdin, never a command line.
seed_admin = hash=$$(printf "SET client_min_messages = warning; \
		CREATE EXTENSION IF NOT EXISTS pgcrypto; \
		SELECT crypt('%s', gen_salt('bf', 10));" \
		"$$(cat $(SECRETS)/$(1)_admin_password)" | \
		docker exec -i vetchium-staging-$(1)-db-1 psql -U vetchium_owner \
		-d postgres -v ON_ERROR_STOP=1 -qtA); \
	docker exec -i vetchium-staging-$(1)-db-1 psql -U vetchium_owner \
		-d tenant_db -v ON_ERROR_STOP=1 -q -v email=admin@$(1).test \
		-v "name=$(1) Administrator" -v "hash=$$hash" < admin.sql

.PHONY: up down clean secrets info

# Every image is pulled before anything starts, so one deploy never mixes two
# publishes of a moving tag. Each migration runs against its project's internal
# database network before that project's services are replaced, so a failed
# migration leaves the running stack untouched. Generated passwords are hex and
# need no URL escaping.
up: secrets
	@case "$(TAG)" in dev|'') echo "TAG must name a published tag"; exit 1;; esac
	@test -n "$(CLOUDFLARE_TUNNEL_ID)" || \
		{ echo "CLOUDFLARE_TUNNEL_ID is required; see deploy/README.md"; exit 1; }
	@test -s $(SECRETS)/cloudflared_credentials.json || \
		{ echo "$(SECRETS)/cloudflared_credentials.json is missing; see deploy/README.md"; exit 1; }
	@chmod 644 $(SECRETS)/cloudflared_credentials.json
	@install -d -m 700 $(STATE)
	@secret=$$(cat $(SECRETS)/identity_digest_key); \
	root=$$(printf 'vetchium-identity-digest-root\x00%s' "$$secret" | \
		openssl dgst -sha256 -r | cut -d ' ' -f1); \
	key_id=$$(printf 'vetchium/identity-digest/key-id/v1' | \
		openssl dgst -sha256 -mac hmac -macopt "hexkey:$$root" -r | cut -c1-16); \
	sed "s/SET_BY_MAKE_FROM_THE_IDENTITY_DIGEST_KEY/$$key_id/" \
		global-coordinator.json > $(STATE)/global-coordinator.json
	$(global_compose) pull --quiet
	@$(foreach tenant,$(TENANTS),$(call region_compose,$(tenant)) pull --quiet;)
	@docker pull --quiet $(REGISTRY)/global-migrate:$(TAG) >/dev/null
	@docker pull --quiet $(REGISTRY)/migrate:$(TAG) >/dev/null
	@set -e; \
	migrate() { \
		f=$$(mktemp); chmod 600 "$$f"; \
		printf 'GOOSE_DBSTRING=postgres://vetchium_owner:%s@%s:5432/%s?sslmode=disable\n' \
			"$$(cat "$(SECRETS)/$$4")" "$$3" "$$5" > "$$f"; \
		if docker run --rm --network "$$2" --env-file "$$f" \
				"$(REGISTRY)/$$1:$(TAG)" up; then rm -f "$$f"; else \
			rm -f "$$f"; \
			echo "$$1 on $$2 failed; that stack was not updated"; \
			exit 1; \
		fi; \
	}; \
	$(global_compose) up --detach --wait --wait-timeout $(WAIT_TIMEOUT) global-db; \
	migrate global-migrate vetchium-staging_global_backend global-db \
		global_postgres_password global_db; \
	$(global_compose) up --detach --wait --wait-timeout $(WAIT_TIMEOUT) \
		--remove-orphans; \
	$(foreach tenant,$(TENANTS), \
		$(call region_compose,$(tenant)) up --detach --wait \
			--wait-timeout $(WAIT_TIMEOUT) db; \
		migrate migrate vetchium-staging-$(tenant)_backend db \
			$(tenant)_postgres_password tenant_db; \
		$(call seed_admin,$(tenant)); \
		$(call region_compose,$(tenant)) up --detach --wait \
			--wait-timeout $(WAIT_TIMEOUT) --remove-orphans;)
	@echo "staging is running $(TAG) ($$(docker image inspect --format \
		'{{index .Config.Labels "org.opencontainers.image.version"}}' \
		$(REGISTRY)/hub-api:$(TAG)))"
	@$(MAKE) --no-print-directory info

# Prints where staging answers and how to get in. Names secret files rather
# than their contents, so deploy output never carries a password.
info:
	@printf '\n%s\n' 'Portals'
	@printf '  %-8s %s\n' Hub https://vetchium.com Orgs https://orgs.vetchium.com \
		Mail https://staging-mail.vetchium.com
	@printf '  %-8s %s\n' '' 'user staging, password in $(CURDIR)/$(SECRETS)/mailpit_ui_password'
	@printf '\n%s\n' 'Regions: API, Admin portal, media'
	@$(foreach tenant,$(TENANTS),printf '  %-8s %-30s %-32s %s\n' $(tenant) \
		https://$(tenant)-api.vetchium.com https://$(tenant)-admin.vetchium.com \
		https://$(tenant)-media.vetchium.com;)
	@printf '\n%s\n' 'Admin portal sign-in, with every permission'
	@$(foreach tenant,$(TENANTS),printf '  %-8s %-16s password in %s\n' $(tenant) \
		admin@$(tenant).test $(CURDIR)/$(SECRETS)/$(tenant)_admin_password;)
	@printf '\n%s\n' 'Notes'
	@printf '  - %s\n' \
		'All staging mail lands in Mailpit; none reaches a real inbox.' \
		'Hub signup accepts any @test.test address in every region.' \
		'Org signup accepts .test and .example domains with no DNS record.' \
		'make staging-clean deletes all staging data; make -C deploy/staging down stops it and keeps the data.' \
		'Logs: docker compose --project-name vetchium-staging-<region> logs -f hub-api'

# Stops every project and keeps the volumes. Regions go first: they hold the
# shared networks the global project created.
down:
	@$(foreach tenant,$(TENANTS),docker compose --project-name vetchium-staging-$(tenant) down;)
	docker compose --project-name vetchium-staging down

# Stops every project and deletes its volumes; the secrets stay and initialize
# the next deploy's empty databases and object stores.
clean:
	@$(foreach tenant,$(TENANTS),docker compose --project-name vetchium-staging-$(tenant) \
		down --volumes --remove-orphans;)
	docker compose --project-name vetchium-staging down --volumes --remove-orphans
	rm -rf $(STATE)

# Creates whatever is missing and never replaces an existing secret: the
# databases and object stores in the volumes were initialized with them.
# Compose bind-mounts each secret file with its host mode and the services run
# as unprivileged users, so files are world-readable inside the 0700 directory.
secrets:
	@install -d -m 700 $(SECRETS)
	@../../dev/generate-mesh-pki.sh $(SECRETS) $(TENANTS)
	@../../dev/generate-wireguard-keys.sh $(SECRETS) global-coordinator $(TENANTS)
	@sh ../../dev/generate-seaweed-s3-secrets.sh $(SECRETS) $(TENANTS)
	@umask 077; for name in identity_digest_key \
		global_postgres_password global_app_postgres_password \
		$(foreach tenant,$(TENANTS),$(tenant)_postgres_password \
			$(tenant)_app_postgres_password $(tenant)_admin_credential_key \
			$(tenant)_hub_credential_key $(tenant)_orgs_credential_key \
			$(tenant)_mesh_credential $(tenant)_admin_password); do \
		test -s "$(SECRETS)/$$name" || \
			printf '%s' "$$(openssl rand -hex 32)" > "$(SECRETS)/$$name"; \
	done
	@umask 077; if ! test -s $(SECRETS)/mailpit_ui_password || \
		! test -s $(SECRETS)/mailpit_ui_auth; then \
		printf '%s' "$$(openssl rand -hex 16)" > $(SECRETS)/mailpit_ui_password; \
		printf 'staging:%s\n' \
			"$$(openssl passwd -apr1 -stdin < $(SECRETS)/mailpit_ui_password)" \
			> $(SECRETS)/mailpit_ui_auth; \
	fi
	@find $(SECRETS) -type f ! -name mesh_ca_key -exec chmod 644 {} +
