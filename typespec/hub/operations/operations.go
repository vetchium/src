package operations

import "github.com/vetchium/src/typespec/directory"

type OperationID string
type OperationState string

const (
	Pending   OperationState = "pending"
	Succeeded OperationState = "succeeded"
	Failed    OperationState = "failed"
)

func IsOperationID(value OperationID) bool {
	return directory.IsCommandID(directory.CommandID(value))
}

func IsOperationState(value OperationState) bool {
	return value == Pending || value == Succeeded || value == Failed
}

type PendingOperation struct {
	OperationID OperationID `json:"operation_id"`
}

type GetOperationRequest struct {
	OperationID OperationID `json:"operation_id"`
}

func (r *GetOperationRequest) Normalize() {}

func (r GetOperationRequest) Validate() []string {
	if !IsOperationID(r.OperationID) {
		return []string{"operation_id"}
	}
	return []string{}
}

type OperationStatus struct {
	OperationID OperationID    `json:"operation_id"`
	State       OperationState `json:"state"`
}
