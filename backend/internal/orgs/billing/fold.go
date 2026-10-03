package billing

import subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

// FoldInvoiceChanges reduces the invoice writes of a chain of transitions to
// the net writes a single statement can make. One statement cannot update a
// row it also inserts, so an invoice opened and then retried, paid, or voided
// within the same batch is written once, in its final form. Writes against the
// Org's already-stored open invoice keep only the last one, which is the only
// one that matters because every such write ends or updates that invoice.
func FoldInvoiceChanges(transitions []Transition) []InvoiceChange {
	var created []InvoiceChange
	var openIndex = -1
	var stored *InvoiceChange
	for _, transition := range transitions {
		change := transition.Invoice
		if change == nil {
			continue
		}
		switch change.Op {
		case InvoiceCreate:
			created = append(created, *change)
			if change.Invoice.State == subscriptionspec.InvoiceOpen {
				openIndex = len(created) - 1
			}
		default:
			if openIndex >= 0 {
				// The invoice was opened earlier in this batch.
				created[openIndex] = InvoiceChange{
					Op: InvoiceCreate, Invoice: change.Invoice,
				}
				if change.Invoice.State != subscriptionspec.InvoiceOpen {
					openIndex = -1
				}
				continue
			}
			final := *change
			stored = &final
		}
	}
	if stored != nil {
		created = append(created, *stored)
	}
	return created
}
