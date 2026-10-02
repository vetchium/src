package handlerauth

import "testing"

func TestEmailLinkNamesTheRegion(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		path, tenant, token, want string
	}{
		{
			"/reset-password", "deu", "a+b/c",
			"https://vetchium.com/reset-password?region=deu&token=a%2Bb%2Fc",
		},
		{"/login", "usa1", "", "https://vetchium.com/login?region=usa1"},
	} {
		got := EmailLink("https://vetchium.com", tt.path, tt.tenant, tt.token)
		if got != tt.want {
			t.Errorf("EmailLink(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}
