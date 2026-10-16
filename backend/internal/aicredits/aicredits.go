// Package aicredits converts model token usage into Vetchium AI credits.
package aicredits

// perMillion is the token unit of a credit rate.
const perMillion = 1_000_000

// messageOverheadTokens over-counts the template tokens a chat model adds
// around each message, so a reservation stays an upper bound.
const messageOverheadTokens = 64

// Rates are a model's credits per million input and output tokens.
type Rates struct {
	InputPerMillion  int64
	OutputPerMillion int64
}

// Cost is the charge for the tokens, rounded up to a whole credit so a call
// is never free by rounding.
func Cost(rates Rates, inputTokens, outputTokens int64) int64 {
	total := inputTokens*rates.InputPerMillion +
		outputTokens*rates.OutputPerMillion
	return (total + perMillion - 1) / perMillion
}

// Reservation is the most a call can cost before its token counts are known.
// A byte-level tokenizer emits at most one token per input byte, so the
// prompt's UTF-8 length bounds its input tokens.
func Reservation(
	rates Rates, promptBytes, messages, maxOutputTokens int,
) int64 {
	input := int64(promptBytes) + int64(messages)*messageOverheadTokens
	return max(Cost(rates, input, int64(maxOutputTokens)), 1)
}
