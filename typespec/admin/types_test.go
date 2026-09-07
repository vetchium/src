package admin

import (
	"slices"
	"testing"
)

func TestFrontendLocales(t *testing.T) {
	t.Parallel()
	want := []FrontendLocale{EnglishUnitedStates, Tamil, German}
	got := FrontendLocales()
	if !slices.Equal(got, want) {
		t.Fatalf("FrontendLocales() = %v, want %v", got, want)
	}
	got[0] = "changed"
	if !IsFrontendLocale(EnglishUnitedStates) {
		t.Fatal("caller mutated the Admin locale set")
	}
	if IsFrontendLocale("fr-FR") {
		t.Fatal("unsupported Admin locale was accepted")
	}
}
