package hub

import (
	"encoding/json"
	"testing"
)

func TestHubAccountHomedElsewhereErrorEncodesExtensionMembers(t *testing.T) {
	t.Parallel()
	encoded, err := json.Marshal(HubAccountHomedElsewhereError("usa1", "US"))
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"type":            "vetchium-problem-details/hub-account-homed-elsewhere",
		"title":           "Hub account homed in another region",
		"status":          float64(409),
		"detail":          "This Hub account signs in at another region",
		"tenant_id":       "usa1",
		"hosting_country": "US",
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
