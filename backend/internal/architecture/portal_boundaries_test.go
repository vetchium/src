// Package architecture holds structural tests that no single package can
// enforce about itself.
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

// portalPackages maps each portal-owned import path prefix to the portal that
// owns it. Shared behavior belongs in a portal-agnostic package under
// backend/internal/ instead, such as credentials, dbvalue, or handlerauth.
var portalPackages = map[string]string{
	"backend/internal/admin": "admin",
	"backend/handlers/admin": "admin",
	"backend/internal/hub":   "hub",
	"backend/handlers/hub":   "hub",
	"backend/internal/orgs":  "orgs",
	"backend/handlers/org":   "orgs",
	"backend/handlers/orgs":  "orgs",
}

func portalOf(importPath string) (string, bool) {
	for prefix, portal := range portalPackages {
		if importPath == prefix || strings.HasPrefix(importPath, prefix+"/") {
			return portal, true
		}
	}
	return "", false
}

// One portal must never reach into another portal's package. Anything two
// portals need lives in a portal-agnostic package, so a third portal can adopt
// it without copying or importing a sibling.
func TestPortalsDoNotImportEachOther(t *testing.T) {
	t.Parallel()
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	fileSet := token.NewFileSet()
	walked := 0
	err = filepath.WalkDir(root, func(
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
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		dir := "backend/" + filepath.ToSlash(filepath.Dir(relative))
		owner, owned := portalOf(dir)
		if !owned {
			return nil
		}
		walked++
		parsed, err := parser.ParseFile(
			fileSet, path, nil, parser.ImportsOnly,
		)
		if err != nil {
			return err
		}
		for _, imported := range parsed.Imports {
			importPath, err := strconv.Unquote(imported.Path.Value)
			if err != nil {
				return err
			}
			other, isPortal := portalOf(importPath)
			if isPortal && other != owner {
				t.Errorf(
					"%s (%s portal) imports %s (%s portal)",
					filepath.ToSlash(relative), owner, importPath, other,
				)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if walked == 0 {
		t.Fatal("no portal source files were inspected")
	}
}
