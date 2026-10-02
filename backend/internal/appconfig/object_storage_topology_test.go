package appconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestTenantObjectStorageTopology(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	for _, file := range []string{"docker-compose.json", "docker-compose-ci.json"} {
		t.Run(file, func(t *testing.T) {
			var topology struct {
				Services map[string]json.RawMessage `json:"services"`
				Volumes  map[string]json.RawMessage `json:"volumes"`
			}
			readStorageTopology(t, filepath.Join(root, file), &topology)
			for _, tenant := range []string{"sgp", "usa1", "deu", "ind1"} {
				for _, role := range []string{"master", "volume", "filer", "s3"} {
					name := "seaweed-" + role + "-" + tenant
					data, ok := topology.Services[name]
					if !ok {
						t.Errorf("missing %s", name)
						continue
					}
					var service struct {
						Image    string                     `json:"image"`
						Networks map[string]json.RawMessage `json:"networks"`
						Ports    json.RawMessage            `json:"ports"`
						Volumes  []struct {
							Source string `json:"source"`
						} `json:"volumes"`
						Secrets []struct {
							Source string `json:"source"`
						} `json:"secrets"`
					}
					if err := json.Unmarshal(data, &service); err != nil {
						t.Fatal(err)
					}
					if !strings.Contains(service.Image, "seaweedfs:4.47@sha256:") {
						t.Errorf("%s image is not pinned: %q", name, service.Image)
					}
					if _, ok := service.Networks[tenant+"_backend"]; !ok || len(service.Networks) != 1 {
						t.Errorf("%s networks = %v", name, service.Networks)
					}
					if len(service.Ports) != 0 {
						t.Errorf("%s publishes ports: %s", name, service.Ports)
					}
					if role != "s3" {
						volume := "seaweed-" + role + "data-" + tenant
						if _, ok := topology.Volumes[volume]; !ok || len(service.Volumes) != 1 || service.Volumes[0].Source != volume {
							t.Errorf("%s lacks isolated persistent volume %s", name, volume)
						}
					} else if len(service.Secrets) != 1 || service.Secrets[0].Source != "seaweed_s3_"+tenant+"_config" {
						t.Errorf("%s lacks tenant S3 identity secret", name)
					}
				}
				for _, role := range []string{"hub-api", "mesh-api", "orgs-api", "workers"} {
					name := role + "-" + tenant
					var service struct {
						Secrets []struct {
							Source string `json:"source"`
							Target string `json:"target"`
						} `json:"secrets"`
					}
					if err := json.Unmarshal(topology.Services[name], &service); err != nil {
						t.Fatal(err)
					}
					for _, key := range []string{"access_key", "secret_key"} {
						found := false
						for _, secret := range service.Secrets {
							if secret.Source == "seaweed_s3_"+tenant+"_"+key && secret.Target == "/run/secrets/seaweed_s3_"+key {
								found = true
							}
						}
						if !found {
							t.Errorf("%s lacks tenant %s", name, key)
						}
					}
				}
			}
		})
	}

	for _, tenant := range []string{"sgp", "usa1", "deu", "ind1"} {
		t.Run("production/"+tenant, func(t *testing.T) {
			var topology struct {
				Services map[string]json.RawMessage `json:"services"`
				Volumes  map[string]json.RawMessage `json:"volumes"`
			}
			readStorageTopology(t, filepath.Join(root, "deploy", tenant, "stack.json"), &topology)
			for _, role := range []string{"master", "volume", "filer", "s3"} {
				name := "seaweed-" + role
				data, ok := topology.Services[name]
				if !ok {
					t.Errorf("missing %s", name)
					continue
				}
				var service struct {
					Image    string          `json:"image"`
					Networks []string        `json:"networks"`
					Ports    json.RawMessage `json:"ports"`
					Volumes  []string        `json:"volumes"`
					Secrets  []string        `json:"secrets"`
				}
				if err := json.Unmarshal(data, &service); err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(service.Image, "seaweedfs:4.47@sha256:") {
					t.Errorf("%s image is not pinned: %q", name, service.Image)
				}
				if len(service.Networks) != 1 || service.Networks[0] != "backend" || len(service.Ports) != 0 {
					t.Errorf("%s has public network/ports: %v %s", name, service.Networks, service.Ports)
				}
				if role != "s3" {
					volume := "seaweed-" + role + "data"
					if _, ok := topology.Volumes[volume]; !ok || len(service.Volumes) != 1 || service.Volumes[0] != volume+":/data" {
						t.Errorf("%s lacks persistent volume %s", name, volume)
					}
				} else if len(service.Secrets) != 1 || service.Secrets[0] != "seaweed_s3_config" {
					t.Errorf("%s lacks S3 identity secret", name)
				}
			}
			for _, role := range []string{"hub-api", "mesh-api", "workers"} {
				var service struct {
					Secrets []string `json:"secrets"`
				}
				if err := json.Unmarshal(topology.Services[role], &service); err != nil {
					t.Fatal(err)
				}
				for _, key := range []string{"access_key", "secret_key"} {
					found := false
					for _, secret := range service.Secrets {
						if secret == "seaweed_s3_"+key {
							found = true
						}
					}
					if !found {
						t.Errorf("%s lacks %s", role, key)
					}
				}
			}
		})
	}
}

func TestTenantMediaProxyIsolation(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	for _, file := range []string{"docker-compose.json", "docker-compose-ci.json"} {
		var topology struct {
			Services map[string]json.RawMessage `json:"services"`
			Networks map[string]json.RawMessage `json:"networks"`
		}
		readStorageTopology(t, filepath.Join(root, file), &topology)
		for _, tenant := range []string{"sgp", "usa1", "deu", "ind1"} {
			var proxy struct {
				Networks map[string]json.RawMessage `json:"networks"`
				Ports    json.RawMessage            `json:"ports"`
				Secrets  json.RawMessage            `json:"secrets"`
				Volumes  []struct {
					Source string `json:"source"`
				} `json:"volumes"`
			}
			if err := json.Unmarshal(topology.Services["media-proxy-"+tenant], &proxy); err != nil {
				t.Fatal(err)
			}
			if len(proxy.Networks) != 2 || len(proxy.Ports) != 0 ||
				len(proxy.Secrets) != 0 || len(proxy.Volumes) != 1 ||
				proxy.Volumes[0].Source != "./media/nginx.conf" {
				t.Errorf("%s/%s media proxy is not isolated", file, tenant)
			}
			for _, network := range []string{tenant + "_backend", tenant + "_media_access"} {
				if _, ok := proxy.Networks[network]; !ok {
					t.Errorf("%s/%s media proxy lacks %s", file, tenant, network)
				}
			}
			if _, ok := topology.Networks[tenant+"_media_access"]; !ok {
				t.Errorf("%s lacks %s media network", file, tenant)
			}
			var ingress struct {
				Networks map[string]json.RawMessage `json:"networks"`
			}
			if err := json.Unmarshal(topology.Services["traefik-"+tenant], &ingress); err != nil {
				t.Fatal(err)
			}
			if _, ok := ingress.Networks[tenant+"_media_access"]; !ok {
				t.Errorf("%s/%s Traefik lacks media access", file, tenant)
			}
			route, err := os.ReadFile(filepath.Join(root, "traefik", tenant+".json"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(route), "media."+tenant+".localhost") ||
				!strings.Contains(string(route), "Method(`GET`)") ||
				!strings.Contains(string(route), "Method(`HEAD`)") ||
				!strings.Contains(string(route), "PathRegexp(") ||
				!strings.Contains(string(route), "http://media-proxy-"+tenant+":8080") {
				t.Errorf("%s/%s media route is missing or overbroad", file, tenant)
			}
		}
	}
	for _, tenant := range []string{"sgp", "usa1", "deu", "ind1"} {
		var stack struct {
			Services map[string]json.RawMessage `json:"services"`
			Networks map[string]json.RawMessage `json:"networks"`
			Configs  map[string]json.RawMessage `json:"configs"`
		}
		readStorageTopology(t, filepath.Join(root, "deploy", tenant, "stack.json"), &stack)
		var proxy struct {
			Networks []string        `json:"networks"`
			Ports    json.RawMessage `json:"ports"`
			Secrets  json.RawMessage `json:"secrets"`
		}
		if err := json.Unmarshal(stack.Services["media-proxy"], &proxy); err != nil {
			t.Fatal(err)
		}
		if len(proxy.Networks) != 2 || !slices.Contains(proxy.Networks, "backend") ||
			!slices.Contains(proxy.Networks, "media_access") ||
			len(proxy.Ports) != 0 || len(proxy.Secrets) != 0 ||
			len(stack.Networks["media_access"]) == 0 ||
			len(stack.Configs["media_proxy"]) == 0 {
			t.Errorf("%s production media proxy is not isolated", tenant)
		}
		var ingress struct {
			Networks []string `json:"networks"`
		}
		if err := json.Unmarshal(stack.Services["traefik"], &ingress); err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(ingress.Networks, "media_access") ||
			slices.Contains(ingress.Networks, "backend") {
			t.Errorf("%s production Traefik media/backend isolation failed", tenant)
		}
		route, err := os.ReadFile(filepath.Join(root, "deploy", tenant, "traefik.json"))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(route), "media."+tenant+".vetchium.com") ||
			!strings.Contains(string(route), "Method(`GET`)") ||
			!strings.Contains(string(route), "Method(`HEAD`)") ||
			!strings.Contains(string(route), "PathRegexp(") ||
			!strings.Contains(string(route), "http://media-proxy:8080") {
			t.Errorf("%s production media route is missing or overbroad", tenant)
		}
	}
	proxyConfig, err := os.ReadFile(filepath.Join(root, "media", "nginx.conf"))
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"limit_except GET { deny all; }", "proxy_set_header Host $http_host;",
		"proxy_pass_request_body off;", "location / {", "return 404;",
	} {
		if !strings.Contains(string(proxyConfig), required) {
			t.Errorf("media proxy lacks %q", required)
		}
	}
}

func readStorageTopology(t *testing.T, path string, dst any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, dst); err != nil {
		t.Fatal(err)
	}
}
