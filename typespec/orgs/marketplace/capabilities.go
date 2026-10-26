// Package marketplace contains the Org marketplace wire types.
package marketplace

import (
	"slices"

	"github.com/vetchium/src/typespec/orgs/hiring"
)

type Capability string

const (
	Sourcing        Capability = "sourcing"
	Interviewing    Capability = "interviewing"
	Assessment      Capability = "assessment"
	BackgroundCheck Capability = "background_check"
)

var capabilities = []Capability{
	Sourcing, Interviewing, Assessment, BackgroundCheck,
}

var stageKinds = map[Capability]hiring.StageKind{
	Interviewing:    hiring.InterviewStage,
	Assessment:      hiring.AssessmentStage,
	BackgroundCheck: hiring.BackgroundCheckStage,
}

// Capabilities returns every Capability this contract version defines.
func Capabilities() []Capability { return slices.Clone(capabilities) }

func IsCapability(value Capability) bool {
	return slices.Contains(capabilities, value)
}

// StageKind returns the stage kind a stage Capability performs. Sourcing and
// an unknown Capability perform none.
func (c Capability) StageKind() (hiring.StageKind, bool) {
	kind, ok := stageKinds[c]
	return kind, ok
}

// IsStage reports whether the Capability performs stages. `review` stages
// have no Capability: they are in-house only.
func (c Capability) IsStage() bool {
	_, ok := stageKinds[c]
	return ok
}
