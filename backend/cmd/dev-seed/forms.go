package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/vetchium/src/typespec/common"
	hubprofile "github.com/vetchium/src/typespec/hub/profile"
	orgapplications "github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/openings"
)

// engineeringQuestions covers every question type. The last question is
// optional so the later revision can remove it from answered applications.
var engineeringQuestions = []common.ApplicationQuestion{
	{Text: "Current job title", Type: common.QuestionShortText, Required: true},
	{Text: "What draws you to this team?", Type: common.QuestionLongText},
	{
		Text: "Years of professional experience", Type: common.QuestionNumber, Required: true,
		Min: seedValue(int64(0)), Max: seedValue(int64(50)),
	},
	{Text: "Are you authorized to work in the employing country?", Type: common.QuestionYesNo, Required: true},
	{
		Text: "Preferred working pattern", Type: common.QuestionSingleChoice, Required: true,
		Options: []string{"On site", "Hybrid", "Remote"},
	},
	{
		Text: "Languages you have shipped production code in", Type: common.QuestionMultipleChoice,
		Options: []string{"Go", "TypeScript", "Python", "Rust", "Java"},
	},
	{Text: "Portfolio or code sample link", Type: common.QuestionShortText},
}

var panelForm = []hiring.FeedbackCriterion{
	{Text: "System design depth", Type: hiring.CriterionRating, Required: true},
	{Text: "Would you work with them again?", Type: hiring.CriterionYesNo, Required: true},
	{Text: "Strongest moment", Type: hiring.CriterionText},
}

var conversationForm = []hiring.FeedbackCriterion{
	{Text: "Communication", Type: hiring.CriterionRating, Required: true},
	{Text: "Motivation for the role", Type: hiring.CriterionRating, Required: true},
	{Text: "Concerns", Type: hiring.CriterionText},
}

var seedCriterionTexts = []string{
	"Walked through a past outage clearly and owned the follow-ups.",
	"Wants more exposure to on-call before leading incidents.",
	"Explained trade-offs with numbers rather than opinions.",
}

var seedTitles = []string{"Software engineer", "Site reliability engineer", "Data engineer", "Engineering manager"}

// seedAnswers answers every required question and, for two applicants in
// three, the optional ones; index varies the answers between applicants.
func seedAnswers(questions []common.ApplicationQuestion, index int) []orgapplications.ApplicationAnswer {
	answers := []orgapplications.ApplicationAnswer{}
	for _, question := range questions {
		if question.ID == nil || (!question.Required && index%3 == 2) {
			continue
		}
		var value orgapplications.AnswerValue
		switch question.Type {
		case common.QuestionShortText:
			value = orgapplications.TextAnswer(seedTitles[index%len(seedTitles)])
			if !question.Required {
				value = orgapplications.TextAnswer(fmt.Sprintf("https://code.example.com/applicant-%d", index+1))
			}
		case common.QuestionLongText:
			value = orgapplications.TextAnswer("I enjoy building reliable services with a small team.\n\nYour engineering blog showed how you work.")
		case common.QuestionNumber:
			low, high := int64(0), int64(40)
			if question.Min != nil {
				low = *question.Min
			}
			if question.Max != nil {
				high = *question.Max
			}
			value = orgapplications.NumberAnswer(low + int64(index*3+2)%(high-low+1))
		case common.QuestionYesNo:
			value = orgapplications.BooleanAnswer(index%4 != 3)
		case common.QuestionSingleChoice:
			value = orgapplications.TextAnswer(question.Options[index%len(question.Options)])
		case common.QuestionMultipleChoice:
			count := len(question.Options)
			value = orgapplications.OptionsAnswer(question.Options[index%count], question.Options[(index+2)%count])
		default:
			continue
		}
		answers = append(answers, orgapplications.ApplicationAnswer{QuestionID: *question.ID, Value: value})
	}
	return answers
}

// seedCriteriaAnswers answers every criterion of an interview stage's form;
// rating varies the ratings between interviewers.
func seedCriteriaAnswers(form []hiring.FeedbackCriterion, rating int) []orgapplications.CriterionAnswer {
	answers := []orgapplications.CriterionAnswer{}
	for index, criterion := range form {
		if criterion.ID == nil {
			continue
		}
		var value orgapplications.AnswerValue
		switch criterion.Type {
		case hiring.CriterionRating:
			value = orgapplications.NumberAnswer(int64(min(5, rating+index%2)))
		case hiring.CriterionYesNo:
			value = orgapplications.BooleanAnswer(rating >= 3)
		case hiring.CriterionText:
			value = orgapplications.TextAnswer(seedCriterionTexts[rating%len(seedCriterionTexts)])
		default:
			continue
		}
		answers = append(answers, orgapplications.CriterionAnswer{CriterionID: *criterion.ID, Value: value})
	}
	return answers
}

// liveOpening reads an Opening that must be published.
func (s *orgApplicationSeed) liveOpening(ctx context.Context, number openings.OpeningNumber) (openings.OrgOpening, error) {
	var opening openings.OrgOpening
	if err := s.post(ctx, "/api/orgs/get-opening", openings.GetOpeningRequest{OpeningNumber: number}, s.admin, http.StatusOK, &opening); err != nil {
		return opening, fmt.Errorf("read Opening %d: %w", number, err)
	}
	if opening.State != openings.Published || opening.LiveContent == nil {
		return opening, fmt.Errorf("opening %d is %q, not published", number, opening.State)
	}
	return opening, nil
}

// reviseQuestions makes edit(live questions) the Opening's live questions; the
// admin's own revise request applies at once.
func (s *orgApplicationSeed) reviseQuestions(
	ctx context.Context, edit func([]common.ApplicationQuestion) []common.ApplicationQuestion,
) error {
	opening, err := s.liveOpening(ctx, s.opening)
	if err != nil {
		return err
	}
	content := *opening.LiveContent
	content.Questions = edit(content.Questions)
	var saved openings.OrgOpening
	if err := s.post(ctx, "/api/orgs/save-opening-working-copy", openings.SaveOpeningWorkingCopyRequest{
		OpeningNumber: s.opening, Version: opening.Version, Content: &content,
	}, s.admin, http.StatusOK, &saved); err != nil {
		return fmt.Errorf("save questions: %w", err)
	}
	var revised openings.OrgOpening
	if err := s.post(ctx, "/api/orgs/request-opening-change", openings.RequestOpeningChangeRequest{
		OpeningNumber: s.opening, Version: saved.Version, Kind: openings.ReviseRequest,
	}, s.admin, http.StatusOK, &revised); err != nil {
		return fmt.Errorf("revise questions: %w", err)
	}
	if revised.LiveContent == nil {
		return fmt.Errorf("opening %d has no live content after the revision", s.opening)
	}
	s.questions = revised.LiveContent.Questions
	return nil
}

// reviseAfterAnswers rewords one answered question and removes another, so
// application detail shows answers to `changed` and `removed` questions.
func reviseAfterAnswers(questions []common.ApplicationQuestion) []common.ApplicationQuestion {
	revised := []common.ApplicationQuestion{}
	for _, question := range questions {
		switch question.Text {
		case "Portfolio or code sample link":
			continue
		case "Years of professional experience":
			question.Text = "Years of professional software experience"
		}
		revised = append(revised, question)
	}
	return revised
}

// interviewStartLead is how far ahead a seeded interview with feedback
// starts: the API takes only future start times, and outcomes and feedback
// only after the start, so the seed waits this long instead of backdating.
const interviewStartLead = 3 * time.Second

// soonStart is a whole-second start time interviewStartLead from now.
func soonStart() time.Time {
	return time.Now().Add(interviewStartLead).Truncate(time.Second).Add(time.Second).UTC()
}

func (s *orgApplicationSeed) scheduleSoon(ctx context.Context, number orgapplications.ApplicationNumber) (time.Time, error) {
	start := soonStart()
	video := hubprofile.WebsiteURL("https://meet.example.com/conversation-" + fmt.Sprint(number))
	return start, s.act(ctx, "schedule-interview", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.ScheduleInterviewRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v,
			InterviewDetails: orgapplications.InterviewDetails{
				StartTime: start, DurationMinutes: 30,
				Mode: orgapplications.InterviewVideo, VideoURL: &video,
				InterviewerEmails: s.reviewers,
			},
		}
	})
}

// completeWithFeedback waits for the interview to start, records it
// completed, and has each reviewer submit feedback answering the stage form.
func (s *orgApplicationSeed) completeWithFeedback(
	ctx context.Context, number orgapplications.ApplicationNumber, start time.Time,
) error {
	if err := sleepUntil(ctx, start); err != nil {
		return err
	}
	if err := s.act(ctx, "record-interview-outcome", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.RecordInterviewOutcomeRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v,
			InterviewNumber: 1, Outcome: orgapplications.OutcomeCompleted,
		}
	}); err != nil {
		return err
	}
	var detail orgapplications.ApplicationDetail
	if err := s.post(ctx, "/api/orgs/get-application", orgapplications.GetApplicationRequest{
		OpeningNumber: s.opening, ApplicationNumber: number,
	}, s.admin, http.StatusOK, &detail); err != nil {
		return err
	}
	if len(detail.Interviews) == 0 {
		return fmt.Errorf("application %d has no interview", number)
	}
	form := detail.Interviews[0].Stage.FeedbackForm
	recruiter, err := s.openingLogin(ctx, s.domain, "recruiter")
	if err != nil {
		return fmt.Errorf("sign in recruiter: %w", err)
	}
	for index, feedback := range []struct {
		token          string
		recommendation orgapplications.InterviewRecommendation
		notes          string
	}{
		{s.admin, orgapplications.StrongYes, "Clear communicator with concrete examples."},
		{recruiter, orgapplications.Yes, "Motivated; asked thoughtful questions about the team."},
	} {
		version, err := s.version(ctx, number)
		if err != nil {
			return err
		}
		if err := s.post(ctx, "/api/orgs/submit-interview-feedback", orgapplications.SubmitInterviewFeedbackRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: version,
			InterviewNumber: 1, Recommendation: feedback.recommendation,
			Notes:           orgapplications.InterviewFeedbackNotes(feedback.notes),
			CriteriaAnswers: seedCriteriaAnswers(form, 4-index),
		}, feedback.token, http.StatusOK, nil); err != nil {
			return fmt.Errorf("feedback %d on application %d: %w", index+1, number, err)
		}
	}
	return nil
}

func sleepUntil(ctx context.Context, at time.Time) error {
	timer := time.NewTimer(time.Until(at) + 500*time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
