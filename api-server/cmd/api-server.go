package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.typespec/hub"
)

type DBConnections struct {
	Global       *pgx.Conn
	RegionalIND1 *pgx.Conn
	RegionalUSA1 *pgx.Conn
	RegionalDEU1 *pgx.Conn
}

func (dbs *DBConnections) getRegionalDB(region string) *pgx.Conn {
	switch region {
	case "ind1":
		return dbs.RegionalIND1
	case "usa1":
		return dbs.RegionalUSA1
	case "deu1":
		return dbs.RegionalDEU1
	default:
		return nil
	}
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

	mux := http.NewServeMux()

	mux.HandleFunc("OPTIONS /hub/login", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("POST /hub/login", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Content-Type", "application/json")

		var loginRequest hub.HubLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&loginRequest); err != nil {
			log.Printf("Failed to decode login request: %v", err)
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(loginRequest.EmailAddress))

		// Query global database for user status and home region
		var status, homeRegion string
		err := dbs.Global.QueryRow(ctx,
			"SELECT status, home_region FROM hub_users WHERE email_address_hash = $1",
			emailHash[:],
		).Scan(&status, &homeRegion)

		if err == pgx.ErrNoRows {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if err != nil {
			log.Printf("Failed to query global DB: %v", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		if status != "active" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Get the regional database for this user
		regionalDB := dbs.getRegionalDB(homeRegion)
		if regionalDB == nil {
			log.Printf("Unknown region: %s", homeRegion)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Query regional database for password hash
		var passwordHash []byte
		err = regionalDB.QueryRow(ctx,
			"SELECT password_hash FROM hub_users WHERE email_address = $1",
			string(loginRequest.EmailAddress),
		).Scan(&passwordHash)

		if err == pgx.ErrNoRows {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if err != nil {
			log.Printf("Failed to query regional DB: %v", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword(passwordHash, []byte(loginRequest.Password)); err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Generate token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Printf("Failed to generate token: %v", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		token := hex.EncodeToString(tokenBytes)

		response := hub.HubLoginResponse{
			Token: token,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Printf("JSON encoding error: %v", err)
			http.Error(w, "Encoding error", http.StatusInternalServerError)
			return
		}
	})

	log.Printf("Server starting on :8080 (region: %s)", region)
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
