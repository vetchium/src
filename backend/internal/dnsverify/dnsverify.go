// Package dnsverify checks the TXT record that proves an Org controls a
// domain. It sends one query to the configured resolver and never falls back to
// the system resolver, so development, CI, and production run the same lookup.
package dnsverify

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

type Result string

const (
	Present      Result = "present"
	Absent       Result = "absent"
	Inconclusive Result = "inconclusive"
)

const (
	recordPrefix = "_vetchium."
	valuePrefix  = "vetchium-verify="
	tokenBytes   = 16
	// A 1232-byte EDNS buffer avoids IP fragmentation on common paths; larger
	// answers come back truncated and are retried over TCP.
	ednsUDPSize = 1232
	maxUDPSize  = 65535
)

var tokenEncoding = base32.NewEncoding(
	"abcdefghijklmnopqrstuvwxyz234567",
).WithPadding(base32.NoPadding)

func RecordName(domain string) string {
	return recordPrefix + domain
}

func RecordValue(token string) string {
	return valuePrefix + token
}

// NewToken returns 128 random bits as 26 lowercase unpadded base32 characters.
func NewToken() (string, error) {
	var raw [tokenBytes]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate DNS verification token: %w", err)
	}
	return tokenEncoding.EncodeToString(raw[:]), nil
}

// IsToken also rejects non-zero padding bits in the last character, so every
// accepted token has exactly one spelling.
func IsToken(token string) bool {
	if len(token) != tokenEncoding.EncodedLen(tokenBytes) {
		return false
	}
	raw, err := tokenEncoding.DecodeString(token)
	return err == nil && len(raw) == tokenBytes &&
		tokenEncoding.EncodeToString(raw) == token
}

type Checker struct {
	resolverAddress   string
	timeout           time.Duration
	trustReservedTLDs bool
}

func New(resolverAddress string, timeout time.Duration) *Checker {
	return &Checker{resolverAddress: resolverAddress, timeout: timeout}
}

// TrustReservedTLDs makes Check answer Present for every name under the
// reserved .test and .example TLDs without querying, so development and CI need
// no published record. example.com is deliberately not covered: it stays a real
// lookup for tests and seeds.
func (c *Checker) TrustReservedTLDs() *Checker {
	c.trustReservedTLDs = true
	return c
}

func underReservedTLD(domain string) bool {
	for _, tld := range []string{"test", "example"} {
		if domain == tld || strings.HasSuffix(domain, "."+tld) {
			return true
		}
	}
	return false
}

// Check never returns Present on error. The error explains an Inconclusive
// result for logs and is nil for Present and Absent.
func (c *Checker) Check(
	ctx context.Context, domain, token string,
) (Result, error) {
	if !IsToken(token) {
		return Inconclusive, errors.New("malformed DNS verification token")
	}
	if c.trustReservedTLDs && underReservedTLD(domain) {
		return Present, nil
	}
	name, err := dnsmessage.NewName(
		strings.TrimSuffix(RecordName(domain), ".") + ".",
	)
	if err != nil {
		return Inconclusive, fmt.Errorf("invalid record name: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	question := dnsmessage.Question{
		Name: name, Type: dnsmessage.TypeTXT, Class: dnsmessage.ClassINET,
	}
	response, err := c.exchange(ctx, question)
	if err != nil {
		return Inconclusive, err
	}
	return evaluate(response, question, RecordValue(token))
}

func evaluate(
	response dnsmessage.Message, question dnsmessage.Question, want string,
) (Result, error) {
	switch response.RCode {
	case dnsmessage.RCodeSuccess, dnsmessage.RCodeNameError:
	default:
		return Inconclusive, fmt.Errorf("resolver answered %s", response.RCode)
	}
	// Without AA or RA the server neither owns the zone nor resolved it: an
	// empty or NXDOMAIN answer is then a referral or a misconfigured resolver,
	// not evidence that the record is missing.
	if !response.Authoritative && !response.RecursionAvailable {
		return Inconclusive, errors.New(
			"resolver answer is neither authoritative nor recursive",
		)
	}
	if response.RCode == dnsmessage.RCodeNameError {
		return Absent, nil
	}

	// A recursive resolver answers for a CNAME'd record name with the chain
	// followed by the target's TXT records.
	owners := map[string]bool{canonical(question.Name): true}
	for changed := true; changed; {
		changed = false
		for _, answer := range response.Answers {
			cname, ok := answer.Body.(*dnsmessage.CNAMEResource)
			if !ok || answer.Header.Class != dnsmessage.ClassINET ||
				!owners[canonical(answer.Header.Name)] {
				continue
			}
			target := canonical(cname.CNAME)
			if !owners[target] {
				owners[target] = true
				changed = true
			}
		}
	}
	for _, answer := range response.Answers {
		txt, ok := answer.Body.(*dnsmessage.TXTResource)
		if !ok || answer.Header.Class != dnsmessage.ClassINET ||
			!owners[canonical(answer.Header.Name)] {
			continue
		}
		// One TXT record may be split into several character strings; its
		// value is their concatenation.
		if strings.Join(txt.TXT, "") == want {
			return Present, nil
		}
	}
	return Absent, nil
}

func canonical(name dnsmessage.Name) string {
	return strings.ToLower(name.String())
}

func (c *Checker) exchange(
	ctx context.Context, question dnsmessage.Question,
) (dnsmessage.Message, error) {
	query, id, err := buildQuery(question)
	if err != nil {
		return dnsmessage.Message{}, err
	}
	response, err := c.exchangeUDP(ctx, query, id, question)
	if err != nil {
		return dnsmessage.Message{}, err
	}
	if !response.Truncated {
		return response, nil
	}
	return c.exchangeTCP(ctx, query, id, question)
}

func buildQuery(question dnsmessage.Question) ([]byte, uint16, error) {
	var idBytes [2]byte
	if _, err := rand.Read(idBytes[:]); err != nil {
		return nil, 0, fmt.Errorf("generate DNS query ID: %w", err)
	}
	id := binary.BigEndian.Uint16(idBytes[:])
	builder := dnsmessage.NewBuilder(nil, dnsmessage.Header{
		ID: id, RecursionDesired: true,
	})
	builder.EnableCompression()
	var edns dnsmessage.ResourceHeader
	err := errors.Join(
		builder.StartQuestions(),
		builder.Question(question),
		builder.StartAdditionals(),
		edns.SetEDNS0(ednsUDPSize, dnsmessage.RCodeSuccess, false),
	)
	if err == nil {
		err = builder.OPTResource(edns, dnsmessage.OPTResource{})
	}
	if err != nil {
		return nil, 0, fmt.Errorf("build DNS query: %w", err)
	}
	query, err := builder.Finish()
	if err != nil {
		return nil, 0, fmt.Errorf("build DNS query: %w", err)
	}
	return query, id, nil
}

func (c *Checker) dial(
	ctx context.Context, network string,
) (net.Conn, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, network, c.resolverAddress)
	if err != nil {
		return nil, fmt.Errorf("dial resolver over %s: %w", network, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetDeadline(deadline); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("set resolver deadline: %w", err)
		}
	}
	// Closing the connection unblocks a read when the caller's context is
	// cancelled before the deadline.
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	return &stoppingConn{Conn: conn, stop: stop}, nil
}

type stoppingConn struct {
	net.Conn
	stop func() bool
}

func (c *stoppingConn) Close() error {
	c.stop()
	return c.Conn.Close()
}

func (c *Checker) exchangeUDP(
	ctx context.Context, query []byte, id uint16,
	question dnsmessage.Question,
) (dnsmessage.Message, error) {
	conn, err := c.dial(ctx, "udp")
	if err != nil {
		return dnsmessage.Message{}, err
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.Write(query); err != nil {
		return dnsmessage.Message{}, contextError(ctx, "send DNS query", err)
	}
	buffer := make([]byte, maxUDPSize)
	for {
		n, err := conn.Read(buffer)
		if err != nil {
			return dnsmessage.Message{}, contextError(
				ctx, "read DNS response", err,
			)
		}
		// A connected UDP socket only receives from the resolver address, but
		// a stale or forged datagram can still arrive; wait for the real one.
		response, ok := parseResponse(buffer[:n], id, question)
		if ok {
			return response, nil
		}
	}
}

func (c *Checker) exchangeTCP(
	ctx context.Context, query []byte, id uint16,
	question dnsmessage.Question,
) (dnsmessage.Message, error) {
	conn, err := c.dial(ctx, "tcp")
	if err != nil {
		return dnsmessage.Message{}, err
	}
	defer func() { _ = conn.Close() }()
	framed := make([]byte, 2+len(query))
	binary.BigEndian.PutUint16(framed, uint16(len(query)))
	copy(framed[2:], query)
	if _, err := conn.Write(framed); err != nil {
		return dnsmessage.Message{}, contextError(ctx, "send DNS query", err)
	}
	var length [2]byte
	if _, err := io.ReadFull(conn, length[:]); err != nil {
		return dnsmessage.Message{}, contextError(
			ctx, "read DNS response", err,
		)
	}
	buffer := make([]byte, binary.BigEndian.Uint16(length[:]))
	if _, err := io.ReadFull(conn, buffer); err != nil {
		return dnsmessage.Message{}, contextError(
			ctx, "read DNS response", err,
		)
	}
	response, ok := parseResponse(buffer, id, question)
	if !ok {
		return dnsmessage.Message{}, errors.New(
			"resolver sent a DNS response that does not match the query",
		)
	}
	return response, nil
}

func parseResponse(
	packet []byte, id uint16, question dnsmessage.Question,
) (dnsmessage.Message, bool) {
	var response dnsmessage.Message
	if err := response.Unpack(packet); err != nil {
		return dnsmessage.Message{}, false
	}
	if !response.Response || response.ID != id ||
		len(response.Questions) != 1 {
		return dnsmessage.Message{}, false
	}
	got := response.Questions[0]
	return response, got.Type == question.Type &&
		got.Class == question.Class &&
		canonical(got.Name) == canonical(question.Name)
}

func contextError(ctx context.Context, action string, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return fmt.Errorf("%s: %w", action, ctxErr)
	}
	return fmt.Errorf("%s: %w", action, err)
}
