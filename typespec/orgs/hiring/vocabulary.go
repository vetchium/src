// Package hiring contains the vocabularies of the Org hiring pipeline.
package hiring

import "slices"

type StageKind string
type CheckType string

const (
	ReviewStage          StageKind = "review"
	AssessmentStage      StageKind = "assessment"
	InterviewStage       StageKind = "interview"
	BackgroundCheckStage StageKind = "background_check"
)

const (
	IdentityCheck   CheckType = "identity"
	EducationCheck  CheckType = "education"
	EmploymentCheck CheckType = "employment"
	CriminalCheck   CheckType = "criminal"
	AddressCheck    CheckType = "address"
	CreditCheck     CheckType = "credit"
	DrugCheck       CheckType = "drug"
)

var stageKinds = []StageKind{
	ReviewStage, AssessmentStage, InterviewStage, BackgroundCheckStage,
}

var checkTypes = []CheckType{
	IdentityCheck, EducationCheck, EmploymentCheck, CriminalCheck,
	AddressCheck, CreditCheck, DrugCheck,
}

// StageKinds returns every stage kind this contract version defines.
func StageKinds() []StageKind { return slices.Clone(stageKinds) }

// CheckTypes returns every check type this contract version defines.
func CheckTypes() []CheckType { return slices.Clone(checkTypes) }

func IsStageKind(value StageKind) bool { return slices.Contains(stageKinds, value) }

func IsCheckType(value CheckType) bool { return slices.Contains(checkTypes, value) }
