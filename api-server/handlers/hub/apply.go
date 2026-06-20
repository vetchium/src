package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func newApplyS3Client(cfg *server.StorageConfig) *awss3.Client {
	endpoint := cfg.Endpoint
	return awss3.New(awss3.Options{
		BaseEndpoint: &endpoint,
		UsePathStyle: true,
		Region:       cfg.Region,
		Credentials:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
	})
}

func uploadResumeToS3(ctx context.Context, cfg *server.StorageConfig, key, contentType string, data []byte) error {
	client := newApplyS3Client(cfg)
	_, err := client.PutObject(ctx, &awss3.PutObjectInput{
		Bucket:        aws.String(cfg.Bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(int64(len(data))),
	})
	return err
}

func detectResumeContentType(data []byte, filename string) (string, error) {
	trimmed := bytes.TrimSpace(data)
	if bytes.HasPrefix(trimmed, []byte("%PDF")) {
		return "application/pdf", nil
	}
	if len(data) >= 4 && data[0] == 0x50 && data[1] == 0x4B && data[2] == 0x03 && data[3] == 0x04 {
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document", nil
	}
	// Markdown has no magic bytes; accept it by extension when the content is
	// valid UTF-8 text.
	lower := strings.ToLower(filename)
	if (strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown")) &&
		utf8.Valid(data) {
		return "text/markdown; charset=utf-8", nil
	}
	return "", fmt.Errorf("resume must be a PDF, DOCX, or Markdown (.md) file")
}

func ApplyForOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		if err := r.ParseMultipartForm(10 << 20); err != nil {
			s.Logger(ctx).Debug("failed to parse multipart form", "error", err)
			http.Error(w, "invalid multipart form", http.StatusBadRequest)
			return
		}

		orgDomain := r.FormValue("org_domain")
		openingNumberStr := r.FormValue("opening_number")
		coverLetter := r.FormValue("cover_letter")
		notifyColleagues := r.FormValue("notify_colleagues_at_target") == "true"
		// Agency attribution: "direct" (or empty) = direct application; otherwise
		// the chosen agency's domain. direct_no_agency_affirmation is required when
		// applying directly to an `open` opening that has pending referrals.
		applyVia := r.FormValue("apply_via")
		if applyVia == "" {
			applyVia = "direct"
		}
		directNoAgencyAffirmation := r.FormValue("direct_no_agency_affirmation") == "true"

		// Optional repeated endorser handles + a shared note. Dedupe so a
		// repeated handle does not collide on the (application, endorser)
		// unique constraint inside the tx.
		var endorserHandles []string
		seenHandle := map[string]bool{}
		for _, h := range r.MultipartForm.Value["endorser_handles"] {
			if h == "" || seenHandle[h] {
				continue
			}
			seenHandle[h] = true
			endorserHandles = append(endorserHandles, h)
		}
		if len(endorserHandles) > 10 {
			http.Error(w, "at most 10 endorsers may be nominated", http.StatusBadRequest)
			return
		}
		endorsementNote := r.FormValue("endorsement_request_note")

		if orgDomain == "" {
			http.Error(w, "org_domain is required", http.StatusBadRequest)
			return
		}
		if openingNumberStr == "" {
			http.Error(w, "opening_number is required", http.StatusBadRequest)
			return
		}
		openingNumberInt, err := strconv.ParseInt(openingNumberStr, 10, 32)
		if err != nil || openingNumberInt < 1 {
			http.Error(w, "opening_number must be a positive integer", http.StatusBadRequest)
			return
		}
		openingNumber := int32(openingNumberInt)

		if len(coverLetter) < 100 || len(coverLetter) > 5000 {
			http.Error(w, "cover_letter must be between 100 and 5000 characters", http.StatusBadRequest)
			return
		}

		resumeFile, resumeHeader, err := r.FormFile("resume")
		if err != nil {
			http.Error(w, "resume file is required", http.StatusBadRequest)
			return
		}
		defer resumeFile.Close()

		resumeData, err := io.ReadAll(io.LimitReader(resumeFile, 5*1024*1024+1))
		if err != nil {
			s.Logger(ctx).Error("failed to read resume", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if len(resumeData) > 5*1024*1024 {
			http.Error(w, "resume file must be ≤5MB", http.StatusBadRequest)
			return
		}

		contentType, err := detectResumeContentType(resumeData, resumeHeader.Filename)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Resolve the OPENING's region (the org's home region, where all hiring
		// data lives) from the org domain — a single global lookup. The hub
		// user may be in a different region; the application must be written in
		// the opening's region, not the caller's.
		// Resolve the opening's region AND snapshot the applicant's preferred
		// display name in one global read (the snapshot is frozen onto the
		// application so later display-name edits don't rewrite history).
		regionInfo, err := s.Global.GetOpeningRegionAndApplicantDisplayName(ctx, globaldb.GetOpeningRegionAndApplicantDisplayNameParams{
			HubUserGlobalID: hubUser.HubUserGlobalID,
			Domain:          orgDomain,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to resolve opening region", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		openingRegion := regionInfo.Region
		applicantDisplayName := regionInfo.PreferredDisplayName
		if applicantDisplayName == "" {
			applicantDisplayName = hubUser.Handle
		}
		openingDB := s.GetRegionalDB(openingRegion)
		if openingDB == nil {
			s.Logger(ctx).Error("unknown opening region", "region", openingRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		// The candidate's connections/preferences live in their own home region.
		homeDB := s.RegionalForCtx(ctx)

		// One regional query (opening's region): verify opening is published.
		opening, err := openingDB.GetPublishedOpeningByDomainAndNumber(ctx,
			regionaldb.GetPublishedOpeningByDomainAndNumberParams{
				HubUserGlobalID: hubUser.HubUserGlobalID,
				OrgDomain:       orgDomain,
				OpeningNumber:   openingNumber,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Agency attribution resolution (opening's region). Multiple agencies may
		// have referred this candidate to this opening; the candidate selects one
		// (or applies directly) here.
		pendingReferrals, err := openingDB.ListPendingReferralsForCandidateOpening(ctx,
			regionaldb.ListPendingReferralsForCandidateOpeningParams{
				OpeningID:                opening.OpeningID,
				CandidateHubUserGlobalID: hubUser.HubUserGlobalID,
			})
		if err != nil {
			s.Logger(ctx).Error("failed to list pending referrals", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var chosenReferral *regionaldb.AgencyReferral
		var referringAgencyOrgID pgtype.UUID
		var referringAgencyDomain pgtype.Text
		if applyVia == "direct" {
			// agency_only openings reject direct applications.
			if opening.ApplicationMode == "agency_only" {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{"error": "agency_only_opening"})
				return
			}
			// Going direct while referrals are pending requires an explicit, logged
			// affirmation that no agency referred the candidate.
			if len(pendingReferrals) > 0 && !directNoAgencyAffirmation {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "agency_affirmation_required"})
				return
			}
		} else {
			// Applying via an agency: it must have a pending referral for this opening.
			for i := range pendingReferrals {
				if pendingReferrals[i].AgencyOrgDomain == applyVia {
					chosenReferral = &pendingReferrals[i]
					break
				}
			}
			if chosenReferral == nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{"error": "no_referral_from_agency"})
				return
			}
			referringAgencyOrgID = chosenReferral.AgencyOrgID
			referringAgencyDomain = pgtype.Text{String: chosenReferral.AgencyOrgDomain, Valid: true}
		}

		// Cool-off enforcement (opening's region): if the org has a cool-off
		// window and this applicant previously reached candidacy (a shortlisted
		// application) at this org, block re-application until the window
		// elapses. Measured from the prior application's applied_at.
		coolOffDays := int32(90) // schema/handler default when no row exists
		if settings, sErr := openingDB.GetOrgHiringSettings(ctx, opening.OrgID); sErr == nil {
			coolOffDays = settings.CoolOffDays
		} else if !errors.Is(sErr, pgx.ErrNoRows) {
			s.Logger(ctx).Error("failed to read hiring settings", "error", sErr)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if coolOffDays > 0 {
			priorAppliedAt, cErr := openingDB.GetLatestCandidacyApplicationAtOrg(ctx,
				regionaldb.GetLatestCandidacyApplicationAtOrgParams{
					OrgID:                    opening.OrgID,
					ApplicantHubUserGlobalID: hubUser.HubUserGlobalID,
				})
			if cErr != nil && !errors.Is(cErr, pgx.ErrNoRows) {
				s.Logger(ctx).Error("failed to check cool-off", "error", cErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			if cErr == nil && priorAppliedAt.Valid {
				earliest := priorAppliedAt.Time.AddDate(0, 0, int(coolOffDays))
				if time.Now().UTC().Before(earliest) {
					w.WriteHeader(http.StatusUnprocessableEntity)
					json.NewEncoder(w).Encode(map[string]string{
						"error":                  "cool_off_active",
						"earliest_next_apply_at": earliest.UTC().Format(time.RFC3339),
					})
					return
				}
			}
		}

		// Validate every nominated endorser is a confirmed connection (in the
		// candidate's home region) before any side effects. Mirrors the
		// /hub/request-endorsements validation.
		peerByHandle := map[string]pgtype.UUID{}
		if len(endorserHandles) > 0 {
			peers, pErr := homeDB.GetConnectedPeersByHandles(ctx, regionaldb.GetConnectedPeersByHandlesParams{
				Me:      hubUser.HubUserGlobalID,
				Handles: endorserHandles,
			})
			if pErr != nil {
				s.Logger(ctx).Error("failed to validate endorser connections", "error", pErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, p := range peers {
				peerByHandle[p.PeerHandle] = p.Peer
			}
			var notConnected []string
			for _, h := range endorserHandles {
				if _, ok := peerByHandle[h]; !ok {
					notConnected = append(notConnected, h)
				}
			}
			if len(notConnected) > 0 {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{
					"error":   "not_a_connection",
					"handles": notConnected,
				})
				return
			}
		}

		// Upload resume to the OPENING's region S3 bucket before the transaction.
		storageCfg := s.GetStorageConfig(openingRegion)
		if storageCfg == nil {
			s.Logger(ctx).Error("no S3 config for region", "region", openingRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		s3Key := fmt.Sprintf("resumes/%s/%d/%s/%s",
			opening.OrgID.String(), opening.OpeningNumber,
			hubUser.HubUserGlobalID.String(), time.Now().UTC().Format("20060102150405"))
		if err := uploadResumeToS3(ctx, storageCfg, s3Key, contentType, resumeData); err != nil {
			s.Logger(ctx).Error("failed to upload resume to S3", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"org_domain":                  orgDomain,
			"opening_number":              openingNumber,
			"notify_colleagues_at_target": notifyColleagues,
		})

		var noteText pgtype.Text
		if endorsementNote != "" {
			noteText = pgtype.Text{String: endorsementNote, Valid: true}
		}

		type createdEndorsementRequest struct {
			requestID  pgtype.UUID
			endorserID pgtype.UUID
		}
		var applicationID pgtype.UUID
		var appliedAt pgtype.Timestamptz
		var createdRequests []createdEndorsementRequest
		// The application + endorsement requests + audit log are written in the
		// OPENING's region (where all hiring data for this org lives).
		writeErr := s.WithRegionalTxFor(ctx, openingRegion, func(qtx *regionaldb.Queries) error {
			createdRequests = nil // reset in case the tx body re-runs
			app, txErr := qtx.CreateApplication(ctx, regionaldb.CreateApplicationParams{
				OrgID:                        opening.OrgID,
				OpeningID:                    opening.OpeningID,
				OpeningNumber:                opening.OpeningNumber,
				ApplicantHubUserGlobalID:     hubUser.HubUserGlobalID,
				ApplicantHandleSnapshot:      hubUser.Handle,
				ApplicantDisplayNameSnapshot: applicantDisplayName,
				CoverLetter:                  coverLetter,
				ResumeS3Key:                  s3Key,
				State:                        "applied",
				NotifyColleaguesAtTarget:     notifyColleagues,
				ReferringAgencyOrgID:         referringAgencyOrgID,
				ReferringAgencyDomain:        referringAgencyDomain,
				DirectAffirmedNoAgency:       applyVia == "direct" && directNoAgencyAffirmation,
			})
			if txErr != nil {
				return txErr
			}
			applicationID = app.ApplicationID
			appliedAt = app.AppliedAt

			// Resolve agency referrals: the chosen agency wins; the others (and
			// any pending referral on a direct application) become not_selected.
			if chosenReferral != nil {
				if _, rErr := qtx.ResolveAgencyReferralAcceptedApplied(ctx, chosenReferral.ReferralID); rErr != nil {
					return rErr
				}
				if rErr := qtx.MarkOtherReferralsNotSelected(ctx, regionaldb.MarkOtherReferralsNotSelectedParams{
					OpeningID:                opening.OpeningID,
					CandidateHubUserGlobalID: hubUser.HubUserGlobalID,
					ReferralID:               chosenReferral.ReferralID,
				}); rErr != nil {
					return rErr
				}
			} else if len(pendingReferrals) > 0 {
				if rErr := qtx.MarkAllPendingReferralsNotSelected(ctx, regionaldb.MarkAllPendingReferralsNotSelectedParams{
					OpeningID:                opening.OpeningID,
					CandidateHubUserGlobalID: hubUser.HubUserGlobalID,
				}); rErr != nil {
					return rErr
				}
			}

			// Create one endorsement request per nominated endorser.
			for _, h := range endorserHandles {
				reqRow, reqErr := qtx.CreateEndorsementRequest(ctx, regionaldb.CreateEndorsementRequestParams{
					ApplicationID:           app.ApplicationID,
					EndorserHubUserGlobalID: peerByHandle[h],
					Note:                    noteText,
				})
				if reqErr != nil {
					return reqErr
				}
				createdRequests = append(createdRequests, createdEndorsementRequest{
					requestID:  reqRow.RequestID,
					endorserID: peerByHandle[h],
				})
			}

			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.apply_for_opening",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if writeErr != nil {
			errStr := writeErr.Error()
			if strings.Contains(errStr, "applications_one_live_per_org") {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": "live_application_exists"})
				return
			}
			if strings.Contains(errStr, "unique") && strings.Contains(errStr, "opening_id") {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": "already_applied"})
				return
			}
			s.Logger(ctx).Error("failed to create application", "error", writeErr)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Cross-DB: insert into global applications_index (compensating pattern).
		// Region is the OPENING's region — where the application row lives.
		if err := s.Global.InsertApplicationIndex(ctx, globaldb.InsertApplicationIndexParams{
			ApplicationID:   applicationID,
			HubUserGlobalID: hubUser.HubUserGlobalID,
			Region:          string(openingRegion),
			OrgID:           opening.OrgID,
			OrgDomain:       orgDomain,
			OpeningNumber:   opening.OpeningNumber,
			AppliedAt:       pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			State:           "applied",
		}); err != nil {
			s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to insert applications_index",
				"application_id", applicationID.String(), "error", err)
		}

		// Cross-DB: mirror the resolved agency-referral states into the global
		// index (best-effort, compensating). The chosen agency becomes
		// accepted_applied; every other pending referral becomes not_selected.
		for i := range pendingReferrals {
			ref := &pendingReferrals[i]
			state := "not_selected"
			if chosenReferral != nil && ref.ReferralID == chosenReferral.ReferralID {
				state = "accepted_applied"
			}
			if idxErr := s.Global.UpdateAgencyReferralIndexState(ctx, globaldb.UpdateAgencyReferralIndexStateParams{
				ReferralID: ref.ReferralID,
				State:      state,
			}); idxErr != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to update referral index state",
					"referral_id", ref.ReferralID.String(), "error", idxErr)
			}
		}

		// Best-effort: notify the referring agency that its referred candidate has
		// applied through it. The agency user lives in the agency's own region,
		// which may differ from the opening's region, so this is enqueued outside
		// the primary transaction.
		if chosenReferral != nil {
			notifyReferringAgency(ctx, s, chosenReferral, opening.Title, opening.OpeningNumber,
				opening.OpeningID.String(), orgDomain, hubUser.Handle)
		}

		// Cross-DB: insert endorsement_requests_index rows (best-effort, mirrors
		// the /hub/request-endorsements compensating pattern).
		for _, cr := range createdRequests {
			if idxErr := s.Global.InsertEndorsementRequestIndex(ctx, globaldb.InsertEndorsementRequestIndexParams{
				RequestID:               cr.requestID,
				EndorserHubUserGlobalID: cr.endorserID,
				Region:                  string(openingRegion),
				ApplicationID:           applicationID,
				State:                   "pending",
				RequestedAt:             appliedAt,
			}); idxErr != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to insert endorsement_requests_index",
					"request_id", cr.requestID.String(), "error", idxErr)
			}
		}

		// Opt-in colleague fan-out (best-effort, post-commit). Connections and
		// their co-located stints live in the CANDIDATE's home region, so this
		// runs there — not in the opening's region. Notifications are best-effort
		// and never affect the application result.
		if notifyColleagues {
			notifyColleaguesOfApplication(ctx, s, homeDB,
				hubUser.HubUserGlobalID, hubUser.Handle, opening.OrgID, opening.Title, orgDomain)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{
			"application_id": applicationID.String(),
		})
	}
}

// notifyColleaguesOfApplication enqueues hub_colleague_applied_alert emails to
// the candidate's connected colleagues who have an active stint at the target
// org. It runs against the candidate's HOME region — where their connection
// edges and the co-located stint rows live — using one bulk email lookup (no
// N+1). It is best-effort: any failure is logged and never affects the apply.
func notifyColleaguesOfApplication(
	ctx context.Context,
	s *server.RegionalServer,
	homeDB *regionaldb.Queries,
	candidateID pgtype.UUID,
	candidateHandle string,
	orgID pgtype.UUID,
	openingTitle string,
	orgDomain string,
) {
	log := s.Logger(ctx)
	colleagues, err := homeDB.ListColleaguesAtOrg(ctx, regionaldb.ListColleaguesAtOrgParams{
		Me:    candidateID,
		OrgID: orgID,
		Limit: 200,
	})
	if err != nil {
		log.Error("colleague fan-out: failed to list colleagues", "error", err)
		return
	}
	if len(colleagues) == 0 {
		return
	}
	ids := make([]pgtype.UUID, 0, len(colleagues))
	for _, c := range colleagues {
		ids = append(ids, c.HubUserGlobalID)
	}
	recipients, err := homeDB.GetHubUserEmailsByGlobalIDs(ctx, ids)
	if err != nil {
		log.Error("colleague fan-out: failed to load emails", "error", err)
		return
	}
	subject := fmt.Sprintf("%s applied to a role at %s", candidateHandle, orgDomain)
	body := fmt.Sprintf("Your connection %s just applied to \"%s\" at %s.",
		candidateHandle, openingTitle, orgDomain)
	for _, rcpt := range recipients {
		if rcpt.EmailAddress == "" {
			continue
		}
		if _, mailErr := homeDB.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
			EmailType:     regionaldb.EmailTemplateTypeHubColleagueAppliedAlert,
			EmailTo:       rcpt.EmailAddress,
			EmailSubject:  subject,
			EmailTextBody: body,
			EmailHtmlBody: body,
		}); mailErr != nil {
			log.Error("colleague fan-out: failed to enqueue email", "error", mailErr)
		}
	}
}
