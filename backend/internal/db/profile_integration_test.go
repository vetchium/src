package db

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

// Run against a migrated disposable tenant database. The transaction leaves
// shared developer data untouched and exercises the generated SQL verbatim.
func TestHubProfileQueryLifecycleIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)

	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid,
         subscription_billing_interval, subscription_anchor_at,
         subscription_period_start, subscription_period_end, profile_alias)
        VALUES ($1, $2, $3, sha256(convert_to($3, 'UTF8')), 'Profile Test',
                'test-hash', 'SG', 'hub-silver-tier', 'month',
                now() - interval '1 month', now() - interval '1 day',
                now() + interval '1 month', 'profile-test-alias')`, did,
		"ptest000-0123456789a", "profile-test-"+dbvalue.FormatUUID(did)+"@example.com")
	if err != nil {
		t.Fatal(err)
	}
	sessionID := profileTestUUID(t)
	if _, err := tx.Exec(ctx, `INSERT INTO vetchium.hub_sessions
        (hub_session_id, hub_user_did, session_token_hash, expires_at)
        VALUES ($1, $2, $3, now() + interval '1 day')`,
		sessionID, did, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	aliasState, err := q.GetHubAliasState(ctx,
		sqlc.GetHubAliasStateParams{
			HubSessionID: sessionID, HubUserDid: did,
		})
	if err != nil || !aliasState.ProfileAlias.Valid ||
		aliasState.ProfileAlias.String != "profile-test-alias" ||
		aliasState.AliasLastChangedAt.Valid {
		t.Fatalf("initial alias state = %+v, %v", aliasState, err)
	}
	viewerHandle, err := q.GetHubProfileViewer(ctx, did)
	if err != nil || viewerHandle != "ptest000-0123456789a" {
		t.Fatalf("profile viewer = %q, %v", viewerHandle, err)
	}

	changed, err := q.SetHubPublicProfile(ctx, sqlc.SetHubPublicProfileParams{
		HubUserDid: did, DisplayName: "Profile Updated",
		Biography: pgtype.Text{String: "A short biography", Valid: true},
		TenantID:  "sgp",
	})
	if err != nil || changed.ProfileVersion != 2 {
		t.Fatalf("set public profile = %+v, %v", changed, err)
	}
	profile, err := q.GetHubPublicProfile(ctx, did)
	if err != nil || profile.DisplayName != "Profile Updated" ||
		string(profile.WorkExperiences) != "[]" {
		t.Fatalf("public profile = %+v, %v", profile, err)
	}
	workID := profileTestUUID(t)
	start := pgtype.Date{Time: time.Date(2020, time.June, 1, 0, 0, 0, 0, time.UTC), Valid: true}
	work, err := q.CreateHubWorkExperience(ctx, sqlc.CreateHubWorkExperienceParams{
		HubUserDid: did, WorkExperienceID: workID,
		EmployerDomain: "example.com", JobTitle: "Engineer", StartMonth: start,
		TenantID: "sgp",
	})
	if err != nil || work.ProfileVersion != 3 {
		t.Fatalf("create work = %+v, %v", work, err)
	}
	_, err = q.UpdateHubWorkExperience(ctx, sqlc.UpdateHubWorkExperienceParams{
		HubUserDid: did, WorkExperienceID: workID,
		EmployerDomain: "example.com", JobTitle: "Senior Engineer",
		StartMonth: start, TenantID: "sgp",
	})
	if err != nil {
		t.Fatal(err)
	}
	assertProfileFieldChange(t, ctx, tx, "hub.profile.work-experience-updated",
		workID, "job_title", true)
	assertProfileFieldChange(t, ctx, tx, "hub.profile.work-experience-updated",
		workID, "employer_domain", false)
	certID := profileTestUUID(t)
	_, err = q.CreateHubCertification(ctx, sqlc.CreateHubCertificationParams{
		HubUserDid: did, CertificationID: certID,
		Title: "Qualification", CredentialUrl: "https://example.org/cert",
		TenantID: "sgp",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.UpdateHubCertification(ctx, sqlc.UpdateHubCertificationParams{
		HubUserDid: did, CertificationID: certID,
		Title: "Updated qualification", CredentialUrl: "https://example.org/cert",
		TenantID: "sgp",
	})
	if err != nil {
		t.Fatal(err)
	}
	assertProfileFieldChange(t, ctx, tx, "hub.profile.certification-updated",
		certID, "title", true)
	_, err = q.AddHubLanguageAbility(ctx, sqlc.AddHubLanguageAbilityParams{
		HubUserDid: did, Ability: sqlc.VetchiumHubLanguageAbilityKindSpeaking,
		LanguageTag: "en", TenantID: "sgp",
	})
	if err != nil {
		t.Fatal(err)
	}
	educationID := profileTestUUID(t)
	_, err = q.CreateHubEducationalQualification(ctx,
		sqlc.CreateHubEducationalQualificationParams{
			HubUserDid: did, EducationalQualificationID: educationID,
			InstitutionDomain: "example.edu", Degree: "Bachelor of Science",
			StartMonth: start, TenantID: "sgp",
		})
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.UpdateHubEducationalQualification(ctx,
		sqlc.UpdateHubEducationalQualificationParams{
			HubUserDid: did, EducationalQualificationID: educationID,
			InstitutionDomain: "example.edu", Degree: "Master of Science",
			StartMonth: start, TenantID: "sgp",
		})
	if err != nil {
		t.Fatal(err)
	}
	assertProfileFieldChange(t, ctx, tx, "hub.profile.education-updated",
		educationID, "degree", true)
	profile, err = q.GetHubPublicProfile(ctx, did)
	if err != nil || string(profile.WorkExperiences) == "[]" ||
		string(profile.Certifications) == "[]" ||
		string(profile.LanguageAbilities) == "[]" ||
		string(profile.EducationalQualifications) == "[]" {
		t.Fatalf("profile with claims = %+v, %v", profile, err)
	}
	var workMonths []struct {
		StartMonth string `json:"start_month"`
	}
	if err := json.Unmarshal(profile.WorkExperiences, &workMonths); err != nil ||
		len(workMonths) != 1 || workMonths[0].StartMonth != "2020-06" {
		t.Fatalf("public work months = %+v, %v", workMonths, err)
	}
	var educationMonths []struct {
		StartMonth string `json:"start_month"`
	}
	if err := json.Unmarshal(profile.EducationalQualifications, &educationMonths); err != nil ||
		len(educationMonths) != 1 || educationMonths[0].StartMonth != "2020-06" {
		t.Fatalf("public education months = %+v, %v", educationMonths, err)
	}
	if _, err := q.DeleteHubWorkExperience(ctx, sqlc.DeleteHubWorkExperienceParams{
		HubUserDid: did, WorkExperienceID: workID, TenantID: "sgp",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.DeleteHubCertification(ctx, sqlc.DeleteHubCertificationParams{
		HubUserDid: did, CertificationID: certID, TenantID: "sgp",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.DeleteHubLanguageAbility(ctx, sqlc.DeleteHubLanguageAbilityParams{
		HubUserDid: did, Ability: sqlc.VetchiumHubLanguageAbilityKindSpeaking,
		LanguageTag: "en", TenantID: "sgp",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.DeleteHubEducationalQualification(ctx,
		sqlc.DeleteHubEducationalQualificationParams{
			HubUserDid: did, EducationalQualificationID: educationID,
			TenantID: "sgp",
		}); err != nil {
		t.Fatal(err)
	}
	var deletedEmployerDomain string
	if err := tx.QueryRow(ctx, `SELECT payload ->> 'employer_domain'
        FROM vetchium.audit_events WHERE action = 'hub.profile.work-experience-deleted'
          AND entity_id = $1`, dbvalue.FormatUUID(workID)).Scan(&deletedEmployerDomain); err != nil || deletedEmployerDomain != "example.com" {
		t.Fatalf("deleted work audit domain = %q, %v", deletedEmployerDomain, err)
	}

	emailID := profileTestUUID(t)
	_, err = q.CreateHubProfessionalEmail(ctx, sqlc.CreateHubProfessionalEmailParams{
		HubUserDid: did, ProfessionalEmailID: emailID,
		EmailAddress: "person@example.org", Domain: "example.org", TenantID: "sgp",
	})
	if err != nil {
		t.Fatal(err)
	}
	var emailAuditContainsAddress bool
	if err := tx.QueryRow(ctx, `SELECT position('person@example.org' in payload::text) > 0
        FROM vetchium.audit_events
        WHERE action = 'hub.profile.professional-email-created'
          AND entity_id = $1`, dbvalue.FormatUUID(emailID)).Scan(
		&emailAuditContainsAddress,
	); err != nil || emailAuditContainsAddress {
		t.Fatalf("professional address in audit = %t, %v",
			emailAuditContainsAddress, err)
	}
	if _, err := q.SupersedeHubProfessionalEmailChallenges(ctx,
		sqlc.SupersedeHubProfessionalEmailChallengesParams{
			ProfessionalEmailID: emailID, HubUserDid: did,
		}); err != nil {
		t.Fatal(err)
	}
	challengeID := profileTestUUID(t)
	codeHash := make([]byte, 32)
	codeHash[0] = 7
	_, err = q.IssueHubProfessionalEmailChallenge(ctx,
		sqlc.IssueHubProfessionalEmailChallengeParams{
			ProfessionalEmailID: emailID, HubUserDid: did,
			ChallengeID: challengeID, CodeHash: codeHash,
			PayloadCiphertext: []byte("encrypted-test-message"), TenantID: "sgp",
		})
	if err != nil {
		t.Fatal(err)
	}
	// Move only the test fixture outside the resend interval, then verify that
	// issuing a newer code makes the previous code unusable.
	if _, err := tx.Exec(ctx, `UPDATE vetchium.hub_professional_email_challenges
        SET created_at = now() - interval '61 seconds' WHERE challenge_id = $1`,
		challengeID); err != nil {
		t.Fatal(err)
	}
	if superseded, err := q.SupersedeHubProfessionalEmailChallenges(ctx,
		sqlc.SupersedeHubProfessionalEmailChallengesParams{
			ProfessionalEmailID: emailID, HubUserDid: did,
		}); err != nil || superseded != 1 {
		t.Fatalf("superseded challenges = %d, %v", superseded, err)
	}
	newChallengeID := profileTestUUID(t)
	if _, err := q.IssueHubProfessionalEmailChallenge(ctx,
		sqlc.IssueHubProfessionalEmailChallengeParams{
			ProfessionalEmailID: emailID, HubUserDid: did,
			ChallengeID: newChallengeID, CodeHash: codeHash,
			PayloadCiphertext: []byte("encrypted-test-message"), TenantID: "sgp",
		}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.VerifyHubProfessionalEmailChallenge(ctx,
		sqlc.VerifyHubProfessionalEmailChallengeParams{
			ChallengeID: challengeID, ProfessionalEmailID: emailID,
			HubUserDid: did, CodeHash: codeHash, TenantID: "sgp",
		}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("superseded challenge verification = %v, want no rows", err)
	}
	challengeID = newChallengeID
	wrongHash := make([]byte, 32)
	result, err := q.VerifyHubProfessionalEmailChallenge(ctx,
		sqlc.VerifyHubProfessionalEmailChallengeParams{
			ChallengeID: challengeID, ProfessionalEmailID: emailID,
			HubUserDid: did, CodeHash: wrongHash, TenantID: "sgp",
		})
	if err != nil || result.Verified || result.AttemptCount != 1 {
		t.Fatalf("failed verification = %+v, %v", result, err)
	}
	result, err = q.VerifyHubProfessionalEmailChallenge(ctx,
		sqlc.VerifyHubProfessionalEmailChallengeParams{
			ChallengeID: challengeID, ProfessionalEmailID: emailID,
			HubUserDid: did, CodeHash: codeHash, TenantID: "sgp",
		})
	if err != nil || !result.Verified || !result.FirstVerifiedAt.Valid ||
		!result.LastVerifiedAt.Valid {
		t.Fatalf("successful verification = %+v, %v", result, err)
	}
	_, err = q.VerifyHubProfessionalEmailChallenge(ctx,
		sqlc.VerifyHubProfessionalEmailChallengeParams{
			ChallengeID: challengeID, ProfessionalEmailID: emailID,
			HubUserDid: did, CodeHash: codeHash, TenantID: "sgp",
		})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("replayed verification error = %v, want no rows", err)
	}

	objectID := profileTestUUID(t)
	stagedID := profileTestUUID(t)
	_, err = q.PrepareHubProfilePictureUpload(ctx,
		sqlc.PrepareHubProfilePictureUploadParams{
			HubUserDid: did, EntitledPlanOids: []string{"hub-silver-tier"},
			ObjectID: stagedID,
			Format:   sqlc.VetchiumHubProfilePictureFormatJpeg,
			ByteSize: 1024, Width: 400, Height: 400,
			ContentSha256: make([]byte, 32), TenantID: "sgp",
		})
	if err != nil {
		t.Fatal(err)
	}
	staged, err := q.GetHubProfilePictureUpload(ctx,
		sqlc.GetHubProfilePictureUploadParams{ObjectID: stagedID, HubUserDid: did})
	if err != nil || staged.State != sqlc.VetchiumHubProfilePictureStateUploading ||
		staged.HubPlanOid != "hub-silver-tier" || !staged.UploadExpiresAt.Valid {
		t.Fatalf("staged picture = %+v, %v", staged, err)
	}
	superseded, err := q.SupersedeHubProfilePictureUploads(ctx,
		sqlc.SupersedeHubProfilePictureUploadsParams{
			HubUserDid: did, EntitledPlanOids: []string{"hub-silver-tier"},
			ObjectID: objectID, TenantID: "sgp",
		})
	if err != nil || superseded != 1 {
		t.Fatalf("superseded staged picture = %d, %v", superseded, err)
	}
	staged, err = q.GetHubProfilePictureUpload(ctx,
		sqlc.GetHubProfilePictureUploadParams{ObjectID: stagedID, HubUserDid: did})
	if err != nil || staged.State != sqlc.VetchiumHubProfilePictureStatePendingDelete {
		t.Fatalf("superseded picture state = %+v, %v", staged, err)
	}
	_, err = q.PrepareHubProfilePictureUpload(ctx,
		sqlc.PrepareHubProfilePictureUploadParams{
			HubUserDid: did, ObjectID: objectID,
			EntitledPlanOids: []string{"hub-silver-tier"},
			Format:           sqlc.VetchiumHubProfilePictureFormatJpeg,
			ByteSize:         1024, Width: 400, Height: 400,
			ContentSha256: make([]byte, 32), TenantID: "sgp",
		})
	if err != nil {
		t.Fatal(err)
	}
	activated, err := q.ActivateHubProfilePicture(ctx,
		sqlc.ActivateHubProfilePictureParams{
			HubUserDid: did, ObjectID: objectID, TenantID: "sgp",
			EntitledPlanOids: []string{"hub-silver-tier"},
		})
	if err != nil || activated.State != sqlc.VetchiumHubProfilePictureStateActive {
		t.Fatalf("activate picture = %+v, %v", activated, err)
	}
	replacementID := profileTestUUID(t)
	if _, err := q.PrepareHubProfilePictureUpload(ctx,
		sqlc.PrepareHubProfilePictureUploadParams{
			HubUserDid: did, ObjectID: replacementID,
			EntitledPlanOids: []string{"hub-silver-tier"},
			Format:           sqlc.VetchiumHubProfilePictureFormatPng,
			ByteSize:         2048, Width: 400, Height: 400,
			ContentSha256: make([]byte, 32), TenantID: "sgp",
		}); err != nil {
		t.Fatal(err)
	}
	retired, err := q.RetireHubProfilePictureForReplacement(ctx,
		sqlc.RetireHubProfilePictureForReplacementParams{
			HubUserDid: did, ObjectID: replacementID,
			EntitledPlanOids: []string{"hub-silver-tier"},
		})
	if err != nil || len(retired) != 1 || retired[0] != objectID {
		t.Fatalf("retired picture = %+v, %v", retired, err)
	}
	activated, err = q.ActivateHubProfilePicture(ctx,
		sqlc.ActivateHubProfilePictureParams{
			HubUserDid: did, ObjectID: replacementID, TenantID: "sgp",
			EntitledPlanOids: []string{"hub-silver-tier"},
		})
	if err != nil || activated.State != sqlc.VetchiumHubProfilePictureStateActive {
		t.Fatalf("activate replacement = %+v, %v", activated, err)
	}
	expiredID := profileTestUUID(t)
	if _, err := q.PrepareHubProfilePictureUpload(ctx,
		sqlc.PrepareHubProfilePictureUploadParams{
			HubUserDid: did, EntitledPlanOids: []string{"hub-silver-tier"},
			ObjectID: expiredID,
			Format:   sqlc.VetchiumHubProfilePictureFormatPng,
			ByteSize: 1024, Width: 400, Height: 400,
			ContentSha256: make([]byte, 32), TenantID: "sgp",
		}); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE vetchium.hub_profile_picture_objects
        SET upload_expires_at = now() - interval '1 second'
        WHERE object_id = $1`, expiredID); err != nil {
		t.Fatal(err)
	}
	if count, err := q.QueueExpiredHubProfilePictureUploads(ctx, "sgp"); err != nil || count < 1 {
		t.Fatalf("expired uploads queued = %d, %v", count, err)
	}
	var expiredAuditCount int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.audit_events
        WHERE entity_id = $1 AND action = 'hub.profile.picture-upload-expired'`,
		dbvalue.FormatUUID(expiredID)).Scan(&expiredAuditCount); err != nil || expiredAuditCount != 1 {
		t.Fatalf("expired upload audit count = %d, %v", expiredAuditCount, err)
	}
	downgradeStagedID := profileTestUUID(t)
	if _, err := q.PrepareHubProfilePictureUpload(ctx,
		sqlc.PrepareHubProfilePictureUploadParams{
			HubUserDid: did, EntitledPlanOids: []string{"hub-silver-tier"},
			ObjectID: downgradeStagedID,
			Format:   sqlc.VetchiumHubProfilePictureFormatJpeg,
			ByteSize: 1024, Width: 400, Height: 400,
			ContentSha256: make([]byte, 32), TenantID: "sgp",
		}); err != nil {
		t.Fatal(err)
	}

	states, _ := json.Marshal([]map[string]any{{
		"hub_user_did": dbvalue.FormatUUID(did),
		"hub_plan_oid": "hub-free-tier",
	}})
	events, _ := json.Marshal([]map[string]any{{
		"hub_user_did": dbvalue.FormatUUID(did),
		"action":       "hub.subscription.plan-changed",
		"actor_type":   "hub_user",
		"actor_id":     dbvalue.FormatUUID(did),
		"payload":      map[string]any{"new_plan": "hub-free-tier"},
	}})
	downgraded, err := q.SaveHubSubscriptionStates(ctx,
		sqlc.SaveHubSubscriptionStatesParams{
			States: states, Events: events, TenantID: "sgp", Source: "hub-api",
		})
	if err != nil || downgraded.UpdatedCount != 1 ||
		downgraded.AliasReleaseCount != 1 ||
		downgraded.PictureDeletionCount != 2 ||
		downgraded.ProfileCleanupAuditCount != 1 {
		t.Fatalf("downgrade = %+v, %v", downgraded, err)
	}
	var stagedState sqlc.VetchiumHubProfilePictureState
	var stagedExpiry pgtype.Timestamptz
	var deleteAfter time.Time
	if err := tx.QueryRow(ctx, `SELECT state, upload_expires_at, next_attempt_at
        FROM vetchium.hub_profile_picture_objects WHERE object_id = $1`,
		downgradeStagedID).Scan(&stagedState, &stagedExpiry, &deleteAfter); err != nil ||
		stagedState != sqlc.VetchiumHubProfilePictureStatePendingDelete ||
		stagedExpiry.Valid || !deleteAfter.After(time.Now()) {
		t.Fatalf("downgraded staged picture = %s, %v, %v, %v",
			stagedState, stagedExpiry, deleteAfter, err)
	}
	profile, err = q.GetHubPublicProfile(ctx, did)
	if err != nil || profile.ProfileAlias.Valid || profile.ProfilePictureObjectID.Valid {
		t.Fatalf("profile after downgrade = %+v, %v", profile, err)
	}
	var pendingAliasReleases int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.federation_operations
        WHERE kind = 'hub-alias-release' AND aggregate_id = $1`,
		dbvalue.FormatUUID(did)).Scan(&pendingAliasReleases); err != nil ||
		pendingAliasReleases != 1 {
		t.Fatalf("pending alias releases = %d, %v", pendingAliasReleases, err)
	}
	releases, err := q.ListRecoverableHubAliasReleases(ctx, 100)
	if err != nil || len(releases) != 1 ||
		releases[0].AggregateID != dbvalue.FormatUUID(did) {
		t.Fatalf("recoverable alias releases = %+v, %v", releases, err)
	}
	var cleanupAudits int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.audit_events
        WHERE entity_id = $1 AND action = 'hub.profile.entitlements-removed'`,
		dbvalue.FormatUUID(did)).Scan(&cleanupAudits); err != nil ||
		cleanupAudits != 1 {
		t.Fatalf("cleanup audit events = %d, %v", cleanupAudits, err)
	}
	// Advance only this transaction's test objects past the bounded in-flight
	// Put window before exercising the retryable deletion lease.
	if _, err := tx.Exec(ctx, `UPDATE vetchium.hub_profile_picture_objects
        SET next_attempt_at = now()
        WHERE hub_user_did = $1 AND state = 'pending_delete'`, did); err != nil {
		t.Fatal(err)
	}
	deletedPictures := map[pgtype.UUID]bool{}
	for i := 0; i < 100 &&
		(!deletedPictures[objectID] || !deletedPictures[replacementID]); i++ {
		leaseToken := profileTestUUID(t)
		claimed, err := q.ClaimHubProfilePictureDeletion(ctx,
			sqlc.ClaimHubProfilePictureDeletionParams{
				LeaseToken: leaseToken, TenantID: "sgp",
			})
		if err != nil {
			t.Fatalf("claim picture deletion: %v", err)
		}
		if claimed.HubUserDid != did {
			continue
		}
		deletedID, err := q.CompleteHubProfilePictureDeletion(ctx,
			sqlc.CompleteHubProfilePictureDeletionParams{
				ObjectID: claimed.ObjectID, LeaseToken: leaseToken,
				TenantID: "sgp",
			})
		if err != nil || deletedID != claimed.ObjectID {
			t.Fatalf("complete picture deletion = %s, %v", deletedID, err)
		}
		deletedPictures[deletedID] = true
	}
	if !deletedPictures[objectID] || !deletedPictures[replacementID] {
		t.Fatalf("deleted picture objects = %+v", deletedPictures)
	}

	commandID := profileTestUUID(t)
	command := sqlc.RecordFederationCommandResultParams{
		CommandID: commandID, SourceTenantID: "deu", Kind: "test-command",
		AggregateID: dbvalue.FormatUUID(did), RequestDigest: make([]byte, 32),
		ResponseStatus: 200, ResponseBody: []byte(`{"ok":true}`),
	}
	if _, err := q.RecordFederationCommandResult(ctx, command); err != nil {
		t.Fatal(err)
	}
	if _, err := q.RecordFederationCommandResult(ctx, command); err != nil {
		t.Fatalf("same command replay: %v", err)
	}
	changedCommand := command
	changedCommand.ResponseStatus = 409
	if _, err := q.RecordFederationCommandResult(ctx, changedCommand); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("conflicting command result = %v, want no rows", err)
	}
}

func TestHubAliasMutationLifecycleIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid,
         subscription_billing_interval, subscription_anchor_at,
         subscription_period_start, subscription_period_end)
        VALUES ($1, 'alist000-0123456789a', $2, sha256(convert_to($2, 'UTF8')),
                'Alias Test', 'test-hash', 'SG', 'hub-silver-tier', 'month',
                now() - interval '1 month', now() - interval '1 day',
                now() + interval '1 month')`, did,
		"alias-test-"+dbvalue.FormatUUID(did)+"@example.com")
	if err != nil {
		t.Fatal(err)
	}
	sessionID := profileTestUUID(t)
	if _, err := tx.Exec(ctx, `INSERT INTO vetchium.hub_sessions
        (hub_session_id, hub_user_did, session_token_hash, expires_at)
        VALUES ($1, $2, $3, now() + interval '1 day')`, sessionID, did,
		make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	state, err := q.GetHubAliasMutationState(ctx,
		sqlc.GetHubAliasMutationStateParams{
			HubUserDid: did, HubSessionID: sessionID,
		})
	if err != nil || state.HasPendingChange || state.ProfileAlias.Valid ||
		state.ProfileVersion != 1 || state.HubPlanOid != "hub-silver-tier" {
		t.Fatalf("initial alias mutation state = %+v, %v", state, err)
	}
	mayDispatch, err := q.HubAliasOperationPreflight(ctx,
		sqlc.HubAliasOperationPreflightParams{
			HubUserDid: did, ExpectedProfileVersion: 1,
		})
	if err != nil || !mayDispatch {
		t.Fatalf("initial preflight = %v, %v", mayDispatch, err)
	}
	operationID := profileTestUUID(t)
	commandID := profileTestUUID(t)
	_, err = q.CreateFederationOperation(ctx,
		sqlc.CreateFederationOperationParams{
			TenantID: "sgp", ActorType: "worker", Source: "workers",
			OperationID: operationID, CommandID: commandID,
			Kind: "hub-alias-change", TargetAuthority: "global-directory",
			AggregateID:        dbvalue.FormatUUID(did),
			OwnerPrincipalType: "hub_user",
			OwnerPrincipalID:   dbvalue.FormatUUID(did),
			IdempotencyKey:     "alias-test-key",
			RequestDigest:      make([]byte, 32),
			PayloadBytes:       []byte(`{"test":"alias"}`),
			ExpiresAt:          dbvalue.Timestamp(time.Now().Add(time.Hour)),
		})
	if err != nil {
		t.Fatal(err)
	}
	state, err = q.GetHubAliasMutationState(ctx,
		sqlc.GetHubAliasMutationStateParams{
			HubUserDid: did, HubSessionID: sessionID,
		})
	if err != nil || !state.HasPendingChange {
		t.Fatalf("pending alias mutation state = %+v, %v", state, err)
	}
	changes, err := q.ListRecoverableHubAliasChanges(ctx, 100)
	if err != nil || len(changes) != 1 || changes[0].OperationID != operationID {
		t.Fatalf("recoverable alias changes = %+v, %v", changes, err)
	}
	_, err = q.ApplyHubProfileAlias(ctx, sqlc.ApplyHubProfileAliasParams{
		HubUserDid: did, ExpectedProfileVersion: 1,
		ProfileAlias: dbvalue.Text("new-alias-test"),
		TenantID:     "sgp", IdempotencyKey: dbvalue.Text("alias-test-key"),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.ApplyHubProfileAlias(ctx, sqlc.ApplyHubProfileAliasParams{
		HubUserDid: did, ExpectedProfileVersion: 1,
		ProfileAlias: dbvalue.Text("wrong-late-alias"),
		TenantID:     "sgp", IdempotencyKey: dbvalue.Text("late-key"),
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("stale alias mutation error = %v", err)
	}
	_, err = tx.Exec(ctx, `UPDATE vetchium.hub_users SET
        hub_plan_oid = 'hub-free-tier', subscription_billing_interval = NULL,
        subscription_anchor_at = NULL, subscription_period_start = NULL,
        subscription_period_end = NULL, profile_alias = NULL,
        profile_version = profile_version + 1
        WHERE hub_user_did = $1`, did)
	if err != nil {
		t.Fatal(err)
	}
	mayDispatch, err = q.HubAliasOperationPreflight(ctx,
		sqlc.HubAliasOperationPreflightParams{
			HubUserDid: did, ExpectedProfileVersion: 1,
		})
	if err != nil || mayDispatch {
		t.Fatalf("downgraded preflight = %v, %v", mayDispatch, err)
	}
	_, err = q.ApplyHubProfileAlias(ctx, sqlc.ApplyHubProfileAliasParams{
		HubUserDid: did, PreviousAlias: dbvalue.Text("new-alias-test"),
		ExpectedProfileVersion: 2,
		ProfileAlias:           dbvalue.Text("newer-alias-test"),
		TenantID:               "sgp", IdempotencyKey: dbvalue.Text("after-downgrade"),
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("downgraded alias mutation error = %v", err)
	}
}

func profileTestUUID(t *testing.T) pgtype.UUID {
	t.Helper()
	id, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func assertProfileFieldChange(
	t *testing.T, ctx context.Context, tx pgx.Tx, action string,
	entityID pgtype.UUID, field string, want bool,
) {
	t.Helper()
	var changed bool
	err := tx.QueryRow(ctx, `SELECT (payload -> 'field_changes' ->> $3)::boolean
        FROM vetchium.audit_events WHERE action = $1 AND entity_id = $2`,
		action, dbvalue.FormatUUID(entityID), field).Scan(&changed)
	if err != nil || changed != want {
		t.Fatalf("%s %s change = %t, %v; want %t", action, field,
			changed, err, want)
	}
}

func TestHubProfileFederationRecoveryIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)

	operationID := profileTestUUID(t)
	commandID := profileTestUUID(t)
	digest := make([]byte, 32)
	created, err := q.CreateFederationOperation(ctx,
		sqlc.CreateFederationOperationParams{
			TenantID: "sgp", ActorType: "worker", Source: "workers",
			OperationID: operationID, CommandID: commandID,
			Kind: "profile-test", TargetAuthority: "deu",
			AggregateID: "profile-test", OwnerPrincipalType: "hub_user",
			OwnerPrincipalID: dbvalue.FormatUUID(operationID),
			IdempotencyKey:   "test-key",
			RequestDigest:    digest, PayloadBytes: []byte(`{"command":"test"}`),
			ExpiresAt: pgtype.Timestamptz{
				Time: time.Now().Add(time.Hour), Valid: true,
			},
		})
	if err != nil || created.State != sqlc.VetchiumFederationOperationStatePending {
		t.Fatalf("create operation = %+v, %v", created, err)
	}
	status, err := q.GetHubFederationOperationStatus(ctx,
		sqlc.GetHubFederationOperationStatusParams{
			OperationID:      operationID,
			OwnerPrincipalID: dbvalue.FormatUUID(operationID),
		})
	if err != nil || status.State != sqlc.VetchiumFederationOperationStatePending {
		t.Fatalf("owned operation status = %+v, %v", status, err)
	}
	_, err = q.GetHubFederationOperationStatus(ctx,
		sqlc.GetHubFederationOperationStatusParams{
			OperationID: operationID, OwnerPrincipalID: "other-hub-user",
		})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("foreign operation status error = %v, want no rows", err)
	}
	otherPortalID := profileTestUUID(t)
	otherCommandID := profileTestUUID(t)
	_, err = q.CreateFederationOperation(ctx,
		sqlc.CreateFederationOperationParams{
			TenantID: "sgp", ActorType: "worker", Source: "workers",
			OperationID: otherPortalID, CommandID: otherCommandID,
			Kind: "profile-test-other-portal", TargetAuthority: "deu",
			AggregateID:        "profile-test-other-portal",
			OwnerPrincipalType: "org_user",
			OwnerPrincipalID:   dbvalue.FormatUUID(operationID),
			IdempotencyKey:     "test-key", RequestDigest: digest,
			PayloadBytes: []byte(`{"test":"other-portal"}`),
			ExpiresAt:    dbvalue.Timestamp(time.Now().Add(time.Hour)),
		})
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.GetHubFederationOperationStatus(ctx,
		sqlc.GetHubFederationOperationStatusParams{
			OperationID:      otherPortalID,
			OwnerPrincipalID: dbvalue.FormatUUID(operationID),
		})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("other portal operation status error = %v, want no rows", err)
	}
	recoverable, err := q.ListRecoverableFederationOperations(ctx, 1000)
	found := false
	for _, item := range recoverable {
		found = found || item.OperationID == operationID
	}
	if err != nil || !found {
		t.Fatalf("recoverable operations = %+v, %v", recoverable, err)
	}
	if rows, err := q.RecordFederationOperationRetry(ctx,
		sqlc.RecordFederationOperationRetryParams{
			TenantID: "sgp", ActorType: "worker", Source: "workers",
			OperationID: operationID, LastError: "temporary failure",
		}); err != nil || rows != 1 {
		t.Fatalf("retry operation = %d, %v", rows, err)
	}
	resolved, err := q.ResolveFederationOperation(ctx,
		sqlc.ResolveFederationOperationParams{
			TenantID: "sgp", ActorType: "worker", Source: "workers",
			OperationID:        operationID,
			State:              sqlc.VetchiumFederationOperationStateSucceeded,
			ResponseStatus:     pgtype.Int4{Int32: 200, Valid: true},
			ResponseCiphertext: []byte("encrypted-response"),
		})
	if err != nil || resolved.State != sqlc.VetchiumFederationOperationStateSucceeded ||
		len(resolved.PayloadBytes) != 0 {
		t.Fatalf("resolve operation = %+v, %v", resolved, err)
	}
	if _, err := q.ResolveFederationOperation(ctx,
		sqlc.ResolveFederationOperationParams{
			TenantID: "sgp", ActorType: "worker", Source: "workers",
			OperationID:        operationID,
			State:              sqlc.VetchiumFederationOperationStateSucceeded,
			ResponseStatus:     pgtype.Int4{Int32: 200, Valid: true},
			ResponseCiphertext: []byte("encrypted-response"),
		}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("resolved operation replay = %v, want no rows", err)
	}

	eventID := profileTestUUID(t)
	_, err = q.CreateFederationOutboxEvent(ctx,
		sqlc.CreateFederationOutboxEventParams{
			EventID: eventID, DestinationTenantID: "deu", Kind: "profile-test",
			AggregateType: "hub_user", AggregateID: "profile-test",
			AggregateVersion: 1, Payload: []byte(`{"test":true}`),
			PayloadDigest: digest,
		})
	if err != nil {
		t.Fatal(err)
	}
	leaseToken := profileTestUUID(t)
	var claimed sqlc.ClaimFederationOutboxEventRow
	for i := 0; i < 100; i++ {
		claimed, err = q.ClaimFederationOutboxEvent(ctx, leaseToken)
		if err != nil || claimed.EventID == eventID {
			break
		}
	}
	if err != nil || claimed.EventID != eventID {
		t.Fatalf("claim outbox = %+v, %v", claimed, err)
	}
	if rows, err := q.CompleteFederationOutboxEvent(ctx,
		sqlc.CompleteFederationOutboxEventParams{
			EventID: eventID, LeaseToken: leaseToken,
		}); err != nil || rows != 1 {
		t.Fatalf("complete outbox = %d, %v", rows, err)
	}
	if rows, err := q.CompleteFederationOutboxEvent(ctx,
		sqlc.CompleteFederationOutboxEventParams{
			EventID: eventID, LeaseToken: leaseToken,
		}); err != nil || rows != 0 {
		t.Fatalf("replayed outbox completion = %d, %v", rows, err)
	}
	receipt := sqlc.RecordFederationInboxReceiptParams{
		EventID: eventID, SourceTenantID: "deu", Kind: "profile-test",
		AggregateType: "hub_user", AggregateID: "profile-test",
		AggregateVersion: 1, PayloadDigest: digest,
	}
	if _, err := q.RecordFederationInboxReceipt(ctx, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err := q.RecordFederationInboxReceipt(ctx, receipt); err != nil {
		t.Fatalf("same inbox receipt replay: %v", err)
	}
	receipt.PayloadDigest = make([]byte, 32)
	receipt.PayloadDigest[0] = 1
	if _, err := q.RecordFederationInboxReceipt(ctx, receipt); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("conflicting inbox receipt = %v, want no rows", err)
	}
}

func TestHubProfileConstraintsIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO vetchium.hub_users
        (hub_user_did, handle, email_address, email_digest, display_name,
         password_hash, resident_country, hub_plan_oid,
         subscription_billing_interval, subscription_anchor_at,
         subscription_period_start, subscription_period_end)
        VALUES ($1, 'pcons000-0123456789a', $2, sha256(convert_to($2, 'UTF8')),
                'Constraint Test', 'test-hash', 'SG', 'hub-silver-tier',
                'month', now() - interval '1 month',
                now() - interval '1 day', now() + interval '1 month')`,
		did, "profile-constraints-"+dbvalue.FormatUUID(did)+"@example.com")
	if err != nil {
		t.Fatal(err)
	}
	expectProfileConstraintError(t, ctx, tx,
		`UPDATE vetchium.hub_users SET profile_alias = 'api'
         WHERE hub_user_did = $1`, did)
	expectProfileConstraintError(t, ctx, tx,
		`INSERT INTO vetchium.hub_work_experiences
         (hub_user_did, employer_domain, job_title, start_month)
         VALUES ($1, '127.0.0.1', 'Engineer', DATE '2020-01-01')`, did)
	expectProfileConstraintError(t, ctx, tx,
		`INSERT INTO vetchium.hub_profile_picture_objects
         (hub_user_did, format, byte_size, width, height, content_sha256,
          upload_expires_at)
         VALUES ($1, 'jpeg', 8388609, 400, 400,
                 decode(repeat('00', 32), 'hex'), now() + interval '1 hour')`, did)
	expectProfileConstraintError(t, ctx, tx,
		`INSERT INTO vetchium.hub_certifications
         (hub_user_did, title, credential_url)
         VALUES ($1, 'Certificate', 'https://user:password@example.org/cert')`, did)
	_, err = tx.Exec(ctx, `INSERT INTO vetchium.hub_professional_emails
        (hub_user_did, email_address, domain)
        VALUES ($1, 'first@example.org', 'example.org')`, did)
	if err != nil {
		t.Fatal(err)
	}
	expectProfileConstraintError(t, ctx, tx,
		`INSERT INTO vetchium.hub_professional_emails
         (hub_user_did, email_address, domain)
         VALUES ($1, 'second@example.org', 'example.org')`, did)
	futureMonth := time.Now().UTC().AddDate(1, 0, 0)
	futureMonth = time.Date(futureMonth.Year(), futureMonth.Month(), 1,
		0, 0, 0, 0, time.UTC)
	_, err = sqlc.New(tx).CreateHubWorkExperience(ctx,
		sqlc.CreateHubWorkExperienceParams{
			HubUserDid: did, WorkExperienceID: profileTestUUID(t),
			EmployerDomain: "example.org", JobTitle: "Future",
			StartMonth: pgtype.Date{Time: futureMonth, Valid: true},
			TenantID:   "sgp",
		})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("future work experience = %v, want no rows", err)
	}
	if _, err := tx.Exec(ctx, "SAVEPOINT profile_constraint"); err != nil {
		t.Fatal(err)
	}
	_, err = sqlc.New(tx).CreateHubWorkExperience(ctx,
		sqlc.CreateHubWorkExperienceParams{
			HubUserDid: did, WorkExperienceID: profileTestUUID(t),
			EmployerDomain: "example.org", JobTitle: "Engineer",
			StartMonth: pgtype.Date{
				Time:  time.Date(2020, time.June, 1, 0, 0, 0, 0, time.UTC),
				Valid: true,
			},
			TenantID: "", // The audit insert must reject this logical write.
		})
	if err == nil {
		t.Fatal("profile write committed despite rejected audit event")
	}
	if _, err := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT profile_constraint"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "RELEASE SAVEPOINT profile_constraint"); err != nil {
		t.Fatal(err)
	}
	var workCount int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vetchium.hub_work_experiences
        WHERE hub_user_did = $1`, did).Scan(&workCount); err != nil || workCount != 0 {
		t.Fatalf("work rows after audit rejection = %d, %v", workCount, err)
	}
}

func expectProfileConstraintError(
	t *testing.T, ctx context.Context, tx pgx.Tx, statement string, args ...any,
) {
	t.Helper()
	if _, err := tx.Exec(ctx, "SAVEPOINT profile_constraint"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, statement, args...); err == nil {
		t.Fatalf("statement unexpectedly passed: %s", statement)
	}
	if _, err := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT profile_constraint"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "RELEASE SAVEPOINT profile_constraint"); err != nil {
		t.Fatal(err)
	}
}
