package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"text/tabwriter"
)

// Portal addresses of the development stack (README.md, Development).
const (
	hubPortalURL  = "http://vetchium.localhost/"
	orgsPortalURL = "http://orgs.vetchium.localhost/"
)

func adminPortalURL(tenant string) string {
	return fmt.Sprintf("http://admin-ui.%s.localhost/", tenant)
}

// accountQueries read every account back from a tenant database as
// tab-separated rows, so the printout shows what the seed steps actually
// created rather than a second copy of their fixtures.
var accountQueries = struct{ admins, hubUsers, orgs, orgUsers string }{
	admins: `
SELECT u.email_address, u.admin_user_state,
    -- Holding every permission no other implies is holding them all.
    CASE WHEN NOT EXISTS (
        SELECT 1 FROM vetchium.admin_permission_catalog AS c
        WHERE NOT EXISTS (
            SELECT 1 FROM vetchium.admin_permission_implications AS i
            WHERE i.implied_permission = c.permission)
          AND NOT EXISTS (
            SELECT 1 FROM vetchium.admin_permissions AS p
            WHERE p.admin_user_id = u.admin_user_id
              AND p.permission = c.permission))
    THEN 'every permission'
    ELSE COALESCE((
        SELECT string_agg(p.permission, ' ' ORDER BY p.permission)
        FROM vetchium.admin_permissions AS p
        WHERE p.admin_user_id = u.admin_user_id), 'no permissions')
    END
FROM vetchium.admin_users AS u
ORDER BY u.email_address`,
	hubUsers: `
SELECT u.email_address, u.display_name, u.hub_plan_oid, u.hub_user_state
FROM vetchium.hub_users AS u
ORDER BY u.email_address`,
	orgs: `
SELECT d.domain::text, o.display_name, o.org_plan_oid, o.org_state,
    COALESCE((
        SELECT string_agg(l.capability_oid, ' ' ORDER BY l.capability_oid)
        FROM vetchium.org_listings AS l
        WHERE l.org_did = o.org_did AND l.listing_state = 'listed'), '')
FROM vetchium.orgs AS o
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
-- Hiring companies first, then the Orgs that list services.
ORDER BY EXISTS (
    SELECT 1 FROM vetchium.org_listings AS l WHERE l.org_did = o.org_did),
    d.domain`,
	orgUsers: `
SELECT d.domain::text, u.email_address, u.org_user_state,
    COALESCE((
        SELECT string_agg(p.permission, ' ' ORDER BY p.permission)
        FROM vetchium.org_user_permissions AS p
        WHERE p.org_user_id = u.org_user_id), '')
FROM vetchium.org_users AS u
JOIN vetchium.org_domains AS d ON d.org_did = u.org_did
ORDER BY d.domain, split_part(u.email_address, '@', 1) <> 'admin',
    u.email_address`,
}

// runAccountSummary prints every seeded account of every tenant, grouped by
// portal, for a developer to click and copy from. It reads the databases
// through `docker compose exec`, which needs no published database port.
func runAccountSummary() error {
	compose := strings.TrimSpace(os.Getenv("DEV_SEED_COMPOSE_FILE"))
	if compose == "" {
		return fmt.Errorf("missing DEV_SEED_COMPOSE_FILE")
	}
	read := func(tenant, query string) ([][]string, error) {
		return queryTenant(compose, tenant, query)
	}
	out := bufio.NewWriter(os.Stdout)
	defer func() { _ = out.Flush() }()
	table := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)

	fmt.Fprintf(out, "\nSeeded accounts. Every password is %s\n", devSeedHubUserPassword)
	fmt.Fprintln(out, "Choose the region shown when you sign in to the Hub or Orgs portal.")

	fmt.Fprintln(out, "\nADMIN PORTAL")
	for _, tenant := range marketplaceSeedTenants {
		rows, err := read(tenant, accountQueries.admins)
		if err != nil {
			return err
		}
		fmt.Fprintf(table, "\n  %s\t%s\n", tenant, adminPortalURL(tenant))
		for _, row := range rows {
			fmt.Fprintf(table, "  \t%s\t%s\n", row[0], describe(row[2], row[1]))
		}
	}
	if err := table.Flush(); err != nil {
		return err
	}

	fmt.Fprintf(out, "\nHUB PORTAL  %s\n\n", hubPortalURL)
	for _, tenant := range marketplaceSeedTenants {
		rows, err := read(tenant, accountQueries.hubUsers)
		if err != nil {
			return err
		}
		for _, row := range rows {
			fmt.Fprintf(table, "  %s\t%s\t%s\n", tenant, row[0],
				describe(row[1]+", "+planName(row[2], "hub-"), row[3]))
		}
	}
	if err := table.Flush(); err != nil {
		return err
	}

	fmt.Fprintf(out, "\nORGS PORTAL  %s\n", orgsPortalURL)
	for _, tenant := range marketplaceSeedTenants {
		orgs, err := read(tenant, accountQueries.orgs)
		if err != nil {
			return err
		}
		users, err := read(tenant, accountQueries.orgUsers)
		if err != nil {
			return err
		}
		usersOf := map[string][][]string{}
		for _, user := range users {
			usersOf[user[0]] = append(usersOf[user[0]], user)
		}
		for _, org := range orgs {
			domain := org[0]
			fmt.Fprintf(out, "\n  %s  %s  (%s, %s)\n  %slogin?domain=%s\n", tenant, org[1],
				orgKind(org[4]), planName(org[2], "org-"), orgsPortalURL, domain)
			if org[3] != "active" {
				fmt.Fprintf(out, "  Org state: %s\n", org[3])
			}
			for _, user := range usersOf[domain] {
				fmt.Fprintf(table, "    %s\t%s\n", user[1], describe(permissionNames(user[3]), user[2]))
			}
			if err := table.Flush(); err != nil {
				return err
			}
		}
	}
	fmt.Fprintln(out)
	return nil
}

// queryTenant runs one query in a tenant's database container and returns
// its tab-separated rows. Values never hold tabs or newlines: they are
// addresses, names, and vocabulary.
func queryTenant(compose, tenant, query string) ([][]string, error) {
	command := exec.Command("docker", "compose", "-f", compose, "exec", "-T",
		"db-"+tenant, "psql", "-U", "pguser", "-d", "tenant_db",
		"-v", "ON_ERROR_STOP=1", "-AtX", "-F", "\t", "-c", query)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("query tenant %s: %w: %s", tenant, err, stderr.String())
	}
	var rows [][]string
	for _, line := range strings.Split(strings.TrimRight(string(output), "\n"), "\n") {
		if line != "" {
			rows = append(rows, strings.Split(line, "\t"))
		}
	}
	return rows, nil
}

// describe names what an account may do, and its state when it cannot sign
// in.
func describe(access, state string) string {
	if state == "active" {
		return access
	}
	return access + " [" + state + "]"
}

// planName shortens a plan OID such as org-silver-tier to "silver".
func planName(oid, prefix string) string {
	return strings.TrimSuffix(strings.TrimPrefix(oid, prefix), "-tier")
}

// orgKind names an Org by the Capabilities it lists.
func orgKind(capabilities string) string {
	if capabilities == "" {
		return "hiring company"
	}
	kinds := []string{}
	for _, capability := range strings.Fields(capabilities) {
		if capability == "sourcing" {
			kinds = append(kinds, "staffing agency")
		} else {
			kinds = append(kinds, strings.ReplaceAll(capability, "_", " ")+" provider")
		}
	}
	return strings.Join(kinds, ", ")
}

// permissionNames lists Org permissions without their "org:" prefix.
func permissionNames(permissions string) string {
	if permissions == "" {
		return "no permissions"
	}
	return strings.ReplaceAll(strings.TrimPrefix(permissions, "org:"), " org:", " ")
}
