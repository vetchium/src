package orgs

import (
	"encoding/json"
	"testing"
)

func TestHomedElsewhereErrorEncodesExtensionMembers(t *testing.T) {
	t.Parallel()
	encoded, err := json.Marshal(HomedElsewhereError("deu"))
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"type":      "vetchium-problem-details/org-homed-elsewhere",
		"title":     "Org homed in another region",
		"status":    float64(409),
		"detail":    "This Org signs in at another region",
		"tenant_id": "deu",
	}
	if len(decoded) != len(want) {
		t.Fatalf("decoded = %v", decoded)
	}
	for field, value := range want {
		if decoded[field] != value {
			t.Fatalf("%s = %v, want %v", field, decoded[field], value)
		}
	}
}
