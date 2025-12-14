module vetchium-api-server.gomodule

go 1.25.2

replace vetchium-api-server.typespec => ../specs/typespec

require (
	github.com/jackc/pgx/v5 v5.7.6
	golang.org/x/crypto v0.37.0
	vetchium-api-server.typespec v0.0.0-00010101000000-000000000000
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	golang.org/x/text v0.24.0 // indirect
)
