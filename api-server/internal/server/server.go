package server

import (
	"log/slog"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

type Server struct {
	Global       *globaldb.Queries
	RegionalIND1 *regionaldb.Queries
	RegionalUSA1 *regionaldb.Queries
	RegionalDEU1 *regionaldb.Queries
	Log          *slog.Logger
}

func (s *Server) GetRegionalDB(region globaldb.Region) *regionaldb.Queries {
	switch region {
	case globaldb.RegionInd1:
		return s.RegionalIND1
	case globaldb.RegionUsa1:
		return s.RegionalUSA1
	case globaldb.RegionDeu1:
		return s.RegionalDEU1
	default:
		return nil
	}
}
