package hubapply

import (
	"slices"
	"testing"

	directoryspec "github.com/vetchium/src/typespec/directory"

	"backend/internal/federation/commands"
)

func TestDecodeRefusesPayloadsThatCanNeverSucceed(t *testing.T) {
	t.Parallel()
	const did = "01900000-0000-7000-8000-000000000001"
	valid := `{"opening_number":1,"applicant_did":"` + did + `","snapshot":` +
		`{"display_name":"Ada","handle":"abcd1234-0123456789a","resident_country":"GB"}}`
	tests := []struct {
		name      string
		authority directoryspec.PrincipalType
		payload   string
		want      []string
	}{
		{"valid", directoryspec.PrincipalOrg, valid, nil},
		{"not JSON", directoryspec.PrincipalOrg, `{`, []string{"payload"}},
		{"unknown field", directoryspec.PrincipalOrg,
			`{"opening_number":1,"extra":1}`, []string{"payload"}},
		{"trailing data", directoryspec.PrincipalOrg,
			valid + ` {}`, []string{"payload"}},
		{"Hub user authority", directoryspec.PrincipalHubUser, valid,
			[]string{"authority_principal_type"}},
		{"invalid fields", directoryspec.PrincipalOrg,
			`{"opening_number":0,"applicant_did":"x","snapshot":{}}`,
			[]string{"opening_number", "applicant_did", "snapshot.display_name",
				"snapshot.handle", "snapshot.resident_country"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, fields := decode(commands.Command{
				Authority: commands.Principal{Type: test.authority},
				Payload:   []byte(test.payload),
			})
			if !slices.Equal(fields, test.want) && (len(fields) != 0 || len(test.want) != 0) {
				t.Fatalf("fields = %v, want %v", fields, test.want)
			}
		})
	}
}
