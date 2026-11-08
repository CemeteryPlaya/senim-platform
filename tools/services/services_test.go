package services

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

const root = "../.."

// node — разобранный YAML без схемы; get идёт по ключам карт.
type node = map[string]any

func get(t *testing.T, n any, path ...string) any {
	t.Helper()
	for _, k := range path {
		m, ok := n.(node)
		if !ok {
			t.Fatalf("mesh.yaml: %v — не карта на ключе %q", path, k)
		}
		n = m[k]
	}
	return n
}

func list(t *testing.T, n any) []any {
	t.Helper()
	l, ok := n.([]any)
	if !ok {
		t.Fatalf("mesh.yaml: ожидался список, получено %T", n)
	}
	return l
}

func mesh(t *testing.T) node {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, "deploy", "compose", "envoy", "mesh.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var doc node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		t.Fatalf("mesh.yaml: %v", err)
	}
	return doc
}

// sans — значения exact из match_typed_subject_alt_names.
func sans(t *testing.T, validation any) []string {
	t.Helper()
	var res []string
	for _, m := range list(t, get(t, validation, "match_typed_subject_alt_names")) {
		if get(t, m, "san_type") != "DNS" {
			t.Fatalf("mesh.yaml: SAN не DNS: %v", m)
		}
		res = append(res, get(t, m, "matcher", "exact").(string))
	}
	return res
}

// Список допущенных клиентов mesh совпадает с MeshClients: пропущенный SAN — молчаливый
// отказ сервису, лишний — доступ тому, кому не положено.
func TestMeshClientSANsMatchList(t *testing.T) {
	doc := mesh(t)
	listeners := list(t, get(t, doc, "static_resources", "listeners"))
	if len(listeners) != 1 {
		t.Fatalf("mesh.yaml: listeners = %d, ожидался 1", len(listeners))
	}
	chains := list(t, get(t, listeners[0], "filter_chains"))
	for _, c := range chains {
		v := get(t, c, "transport_socket", "typed_config", "common_tls_context", "validation_context")
		got, want := sans(t, v), MeshClients()
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			t.Fatalf("mesh.yaml: SAN клиентов %v, по списку сервисов %v", got, want)
		}
	}
}

// Каждый кластер mesh, кроме otel, — сервис из списка, и настроен по шаблону: SNI и SAN
// апстрима — имя сервиса, health — senim.<svc>.v1.*Service, без режима паники.
func TestMeshClustersMatchList(t *testing.T) {
	doc := mesh(t)
	healthName := regexp.MustCompile(`^senim\.([a-z]+)\.v1\.[A-Z][A-Za-z]*Service$`)
	seen := 0
	for _, c := range list(t, get(t, doc, "static_resources", "clusters")) {
		name := get(t, c, "name").(string)
		if name == "otel" {
			continue
		}
		seen++
		if !slices.Contains(Go, name) {
			t.Errorf("кластер %q не в списке services.Go", name)
			continue
		}
		tls := get(t, c, "transport_socket", "typed_config")
		if sni := get(t, tls, "sni"); sni != name {
			t.Errorf("кластер %s: sni = %v", name, sni)
		}
		if got := sans(t, get(t, tls, "common_tls_context", "validation_context")); !slices.Equal(got, []string{name}) {
			t.Errorf("кластер %s: SAN апстрима %v, ожидался [%s]", name, got, name)
		}
		for _, hc := range list(t, get(t, c, "health_checks")) {
			svc, _ := get(t, hc, "grpc_health_check", "service_name").(string)
			if m := healthName.FindStringSubmatch(svc); m == nil || m[1] != name {
				t.Errorf("кластер %s: health service_name %q", name, svc)
			}
			if a := get(t, hc, "grpc_health_check", "authority"); a != name {
				t.Errorf("кластер %s: health authority %v", name, a)
			}
		}
		if p := get(t, c, "common_lb_config", "healthy_panic_threshold", "value"); p != 0 {
			t.Errorf("кластер %s: healthy_panic_threshold = %v, ожидался 0", name, p)
		}
	}
	if seen == 0 {
		t.Fatal("mesh.yaml: нет ни одного кластера сервиса")
	}
}

// dev.vars содержит dev-пароли каждого сервиса из списка (их читают dbinit и natsconf).
func TestDevVarsMatchList(t *testing.T) {
	f, err := os.Open(filepath.Join(root, "deploy", "compose", "dev.vars"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	vars := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if k, v, ok := strings.Cut(line, "="); ok && !strings.HasPrefix(line, "#") && v != "" {
			vars[k] = true
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	for _, s := range Go {
		for _, suffix := range []string{"_OWNER_PASSWORD", "_APP_PASSWORD", "_NATS_PASSWORD"} {
			if key := strings.ToUpper(s) + suffix; !vars[key] {
				t.Errorf("dev.vars: нет %s", key)
			}
		}
	}
}

// Образы Go-сервисов собираются тем же патчем Go, что toolchain в go.mod (на нём CI
// гоняет тесты, -race и govulncheck).
func TestDockerfilesUseToolchain(t *testing.T) {
	mod, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^toolchain go(\d+\.\d+\.\d+)$`).FindSubmatch(mod)
	if m == nil {
		t.Fatal("go.mod: нет строки toolchain goX.Y.Z")
	}
	want := "golang:" + string(m[1]) + "-"
	files, err := filepath.Glob(filepath.Join(root, "services", "*", "Dockerfile"))
	if err != nil || len(files) == 0 {
		t.Fatalf("нет services/*/Dockerfile: %v", err)
	}
	from := regexp.MustCompile(`(?m)^FROM (golang:\S+)`)
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, img := range from.FindAllSubmatch(data, -1) {
			if !strings.HasPrefix(string(img[1]), want) {
				t.Errorf("%s: %s, ожидался %s…", f, img[1], want)
			}
		}
	}
}
