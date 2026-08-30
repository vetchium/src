# Tilt front end for the `make dev` stack.
#
# `tilt up` builds and runs the same docker-compose.json services that
# `make dev` brings up, with the same development secrets, and adds a UI and
# log stream per service. `make dev` recreates the stack from scratch on every
# invocation; Tilt keeps it running and rebuilds only what a change touches.
#
#   tilt up                     every tenant, rebuilding on source changes
#   tilt up -- --tenants sgp    one tenant plus the shared services
#   tilt up -- --manual         build once, then rebuild only on demand
#   tilt logs -f hub-api-sgp    follow one service outside the UI
#   tilt down                   stop the stack; database volumes survive
#
# `tilt down` leaves the volumes and the development secrets in place. Run
# `make clean` for the full teardown `make dev` performs before it starts.

COMPOSE_FILE = 'docker-compose.json'
ALL_TENANTS = ['sgp', 'usa1', 'deu', 'ind1']
PORTALS = ['orgs', 'hub', 'admin']

config.define_string_list('tenants',
                          usage='tenants to run; repeatable (default: all of %s)' % ALL_TENANTS)
config.define_bool('manual',
                   usage='start every service once, then rebuild only when triggered')
cfg = config.parse()

tenants = cfg.get('tenants') or ALL_TENANTS
unknown = [tenant for tenant in tenants if tenant not in ALL_TENANTS]
if unknown:
    fail('unknown tenants %s; docker-compose.json defines %s' % (unknown, ALL_TENANTS))

trigger = TRIGGER_MODE_MANUAL if cfg.get('manual') else TRIGGER_MODE_AUTO

# docker-compose.json mounts the development secrets from .dev-secrets. The
# Makefile owns both their creation and the guard that refuses to change a
# value an already initialized stack is using, so defer to it rather than
# duplicating the defaults here.
local('make dev-secrets', echo_off=True)

# docker-compose.json names the project `vetchium`; Tilt would otherwise infer
# the project name from this directory and run a second, parallel stack that
# `make clean` and the plain `docker compose` commands would not see.
docker_compose(COMPOSE_FILE, project_name='vetchium')

# The published ports carry the same defaults docker-compose.json interpolates,
# so the links match whatever bind and port the environment selected.
edge_port = os.getenv('EDGE_PORT', '80')
edge_suffix = '' if edge_port == '80' else ':' + edge_port
mailpit_port = os.getenv('MAILPIT_PORT', '18025')
# A wildcard bind is an address to listen on, not one to open in a browser.
mailpit_bind = os.getenv('MAILPIT_BIND', '127.0.0.1')
mailpit_host = '127.0.0.1' if mailpit_bind == '0.0.0.0' else mailpit_bind

def portal_link(portal, tenant):
    host = '%s-ui.%s.localhost' % (portal, tenant)
    return link('http://%s%s/' % (host, edge_suffix), host)

# Every resource carries its tenant and its role as labels, so the UI can be
# sliced either way: one tenant's whole stack, or every tenant's hub-api.
enabled = ['edge', 'mailpit', 'global-coordinator']
portal_links = []

for tenant in tenants:
    roles = {
        'database': ['db-' + tenant, 'migrate-' + tenant, 'seed-' + tenant],
        'api': ['admin-api-' + tenant, 'hub-api-' + tenant, 'orgs-api-' + tenant,
                'mesh-api-' + tenant, 'mcp-server-' + tenant],
        'workers': ['workers-' + tenant],
        'edge': ['traefik-' + tenant],
    }
    for role, services in roles.items():
        for service in services:
            dc_resource(service, labels=[tenant, role], trigger_mode=trigger)
            enabled.append(service)

    for portal in PORTALS:
        service = '%s-ui-%s' % (portal, tenant)
        links = [portal_link(portal, tenant)]
        dc_resource(service, labels=[tenant, 'ui'], trigger_mode=trigger, links=links)
        enabled.append(service)
        portal_links.extend(links)

dc_resource('edge', labels=['shared', 'edge'], trigger_mode=trigger,
            links=portal_links)
dc_resource('mailpit', labels=['shared'], trigger_mode=trigger,
            links=[link('http://%s:%s/' % (mailpit_host, mailpit_port), 'mailpit')])
dc_resource('global-coordinator', labels=['shared'], trigger_mode=trigger)

# Tilt starts every service in the compose file unless told otherwise, so a
# tenant subset has to disable the rest explicitly. Tilt re-enables whatever
# the remaining resources depend on, which keeps every tenant's Traefik running
# because `edge` waits on all four; only the excluded tenants' databases, APIs,
# workers, and portals stay down.
if len(tenants) != len(ALL_TENANTS):
    config.set_enabled_resources(enabled)

print('\n' + '\n'.join(['  ' + portal.url for portal in portal_links]) + '\n')
