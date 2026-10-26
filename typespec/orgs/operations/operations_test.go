package operations

import "testing"

func TestOperationRequest(t *testing.T) {
	t.Parallel()
	valid := GetOperationRequest{
		OperationID: "11111111-1111-4111-8111-111111111111",
	}
	if fields := valid.Validate(); len(fields) != 0 {
		t.Fatalf("valid operation id rejected: %v", fields)
	}
	if fields := (GetOperationRequest{OperationID: "bad"}).Validate(); len(fields) != 1 || fields[0] != "operation_id" {
		t.Fatalf("bad operation id fields = %v", fields)
	}
	for _, state := range []OperationState{Pending, Succeeded, Failed} {
		if !IsOperationState(state) {
			t.Errorf("valid state %q rejected", state)
		}
	}
	if IsOperationState("unknown") {
		t.Fatal("unknown operation state accepted")
	}
}
