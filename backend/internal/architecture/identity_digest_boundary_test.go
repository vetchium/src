package architecture_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// forbiddenIdentityDigestImporters are executables that must never be able
// to compute a Hub identity digest: the global coordinator and mesh-api never
// hold the shared digest secret (GU-KEY-002), so they must not even
// transitively import the package that turns it into a key.
var forbiddenIdentityDigestImporters = []string{
	"backend/cmd/global-coordinator",
	"backend/cmd/mesh-api",
}

const identityDigestPackage = "backend/internal/identitydigest"

// TestGlobalCoordinatorAndMeshAPIDoNotImportIdentityDigest walks the whole
// module's import graph (not just direct imports) because a package many
// hops away from an executable's main package could still pull the digest
// key into a binary that must never hold it.
func TestGlobalCoordinatorAndMeshAPIDoNotImportIdentityDigest(t *testing.T) {
	t.Parallel()
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	imports, walked := buildImportGraph(t, root)
	if walked == 0 {
		t.Fatal("no source files were inspected")
	}
	if _, ok := imports[identityDigestPackage]; !ok {
		t.Fatalf(
			"%s was never observed as a package; the import path may have changed",
			identityDigestPackage,
		)
	}

	for _, entry := range forbiddenIdentityDigestImporters {
		if _, ok := imports[entry]; !ok {
			t.Fatalf(
				"%s was never observed as a package; the import path may have changed",
				entry,
			)
		}
		if path, found := reaches(entry, identityDigestPackage, imports); found {
			t.Errorf(
				"%s transitively imports %s via %s",
				entry, identityDigestPackage, strings.Join(path, " -> "),
			)
		}
	}
}

// buildImportGraph maps every backend/... package directory to the set of
// backend/... packages it directly imports.
func buildImportGraph(
	t *testing.T, root string,
) (map[string]map[string]bool, int) {
	t.Helper()
	fileSet := token.NewFileSet()
	imports := make(map[string]map[string]bool)
	walked := 0
	err := filepath.WalkDir(root, func(
		path string, entry fs.DirEntry, err error,
	) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "sqlc" || entry.Name() == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		dir := "backend/" + filepath.ToSlash(filepath.Dir(relative))
		walked++
		parsed, err := parser.ParseFile(
			fileSet, path, nil, parser.ImportsOnly,
		)
		if err != nil {
			return err
		}
		if imports[dir] == nil {
			imports[dir] = make(map[string]bool)
		}
		for _, imported := range parsed.Imports {
			importPath, err := strconv.Unquote(imported.Path.Value)
			if err != nil {
				return err
			}
			if strings.HasPrefix(importPath, "backend/") {
				imports[dir][importPath] = true
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return imports, walked
}

// reaches runs a breadth-first search from start over the import graph and
// returns the path to target when found, for a readable failure message.
func reaches(
	start, target string, imports map[string]map[string]bool,
) ([]string, bool) {
	type node struct {
		pkg  string
		path []string
	}
	visited := map[string]bool{start: true}
	queue := []node{{pkg: start, path: []string{start}}}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for next := range imports[current.pkg] {
			if next == target {
				return append(current.path, next), true
			}
			if visited[next] {
				continue
			}
			visited[next] = true
			queue = append(queue, node{
				pkg:  next,
				path: append(append([]string{}, current.path...), next),
			})
		}
	}
	return nil, false
}
