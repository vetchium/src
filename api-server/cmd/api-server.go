package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5"
)

type DBConnections struct {
	Global       *pgx.Conn
	RegionalIND1 *pgx.Conn
	RegionalUSA1 *pgx.Conn
	RegionalDEU1 *pgx.Conn
}

type HealthResponse struct {
	Status       string `json:"status"`
	Region       string `json:"region"`
	GlobalDB     int    `json:"global_db"`
	RegionalIND1 int    `json:"regional_ind1"`
	RegionalUSA1 int    `json:"regional_usa1"`
	RegionalDEU1 int    `json:"regional_deu1"`
}

func main() {
	log.SetFlags(log.Lshortfile | log.LstdFlags)
	log.Println("Starting server...")

	region := os.Getenv("REGION")
	if region == "" {
		region = "unknown"
	}

	ctx := context.Background()

	// Connect to global database
	globalConn, err := pgx.Connect(ctx, os.Getenv("GLOBAL_DB_CONN"))
	if err != nil {
		log.Fatalf("Failed to connect to global DB: %v", err)
	}
	defer globalConn.Close(ctx)
	log.Println("Connected to global database")

	// Connect to regional databases
	regionalIND1, err := pgx.Connect(ctx, os.Getenv("REGIONAL_DB_IND1_CONN"))
	if err != nil {
		log.Fatalf("Failed to connect to regional DB IND1: %v", err)
	}
	defer regionalIND1.Close(ctx)
	log.Println("Connected to regional database IND1")

	regionalUSA1, err := pgx.Connect(ctx, os.Getenv("REGIONAL_DB_USA1_CONN"))
	if err != nil {
		log.Fatalf("Failed to connect to regional DB USA1: %v", err)
	}
	defer regionalUSA1.Close(ctx)
	log.Println("Connected to regional database USA1")

	regionalDEU1, err := pgx.Connect(ctx, os.Getenv("REGIONAL_DB_DEU1_CONN"))
	if err != nil {
		log.Fatalf("Failed to connect to regional DB DEU1: %v", err)
	}
	defer regionalDEU1.Close(ctx)
	log.Println("Connected to regional database DEU1")

	dbs := &DBConnections{
		Global:       globalConn,
		RegionalIND1: regionalIND1,
		RegionalUSA1: regionalUSA1,
		RegionalDEU1: regionalDEU1,
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// CORS headers for frontend
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Content-Type", "application/json")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		ctx := r.Context()

		// Query each database with a simple SELECT 1
		var globalVal, ind1Val, usa1Val, deu1Val int

		if err := dbs.Global.QueryRow(ctx, "SELECT 1").Scan(&globalVal); err != nil {
			log.Printf("Global DB query error: %v", err)
			http.Error(w, "Global DB error", http.StatusInternalServerError)
			return
		}

		if err := dbs.RegionalIND1.QueryRow(ctx, "SELECT 1").Scan(&ind1Val); err != nil {
			log.Printf("Regional IND1 DB query error: %v", err)
			http.Error(w, "Regional IND1 DB error", http.StatusInternalServerError)
			return
		}

		if err := dbs.RegionalUSA1.QueryRow(ctx, "SELECT 1").Scan(&usa1Val); err != nil {
			log.Printf("Regional USA1 DB query error: %v", err)
			http.Error(w, "Regional USA1 DB error", http.StatusInternalServerError)
			return
		}

		if err := dbs.RegionalDEU1.QueryRow(ctx, "SELECT 1").Scan(&deu1Val); err != nil {
			log.Printf("Regional DEU1 DB query error: %v", err)
			http.Error(w, "Regional DEU1 DB error", http.StatusInternalServerError)
			return
		}

		response := HealthResponse{
			Status:       "ok",
			Region:       region,
			GlobalDB:     globalVal,
			RegionalIND1: ind1Val,
			RegionalUSA1: usa1Val,
			RegionalDEU1: deu1Val,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Printf("JSON encoding error: %v", err)
			http.Error(w, "Encoding error", http.StatusInternalServerError)
			return
		}
	})

	log.Printf("Server starting on :8080 (region: %s)", region)
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
