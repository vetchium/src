package dnsverify

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

const testToken = "abcdefghijklmnopqrstuvwxya"

func TestRecordNameAndValue(t *testing.T) {
	t.Parallel()
	if got := RecordName("acme.example"); got != "_vetchium.acme.example" {
		t.Fatalf("RecordName() = %q", got)
	}
	if got := RecordValue("abc"); got != "vetchium-verify=abc" {
		t.Fatalf("RecordValue() = %q", got)
	}
}

func TestNewTokenShape(t *testing.T) {
	t.Parallel()
	seen := map[string]bool{}
	for range 64 {
		token, err := NewToken()
		if err != nil {
			t.Fatal(err)
		}
		if len(token) != 26 || strings.ToLower(token) != token ||
			strings.ContainsAny(token, "=018") || !IsToken(token) {
			t.Fatalf("NewToken() = %q, want 26 lowercase base32 characters", token)
		}
		if seen[token] {
			t.Fatalf("NewToken() repeated %q", token)
		}
		seen[token] = true
	}
}

func TestIsToken(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		token string
		want  bool
	}{
		{testToken, true},
		{"aaaaaaaaaaaaaaaaaaaaaaaaaa", true},
		{"", false},
		{"abcdefghijklmnopqrstuvwxy", false},
		{"abcdefghijklmnopqrstuvwxyaa", false},
		{"ABCDEFGHIJKLMNOPQRSTUVWXYA", false},
		{"abcdefghijklmnopqrstuvwxy1", false},
		{"abcdefghijklmnopqrstuvwxy=", false},
		// The last character carries three data bits; set padding bits make a
		// second spelling of the same value.
		{"abcdefghijklmnopqrstuvwxyb", false},
	} {
		if got := IsToken(test.token); got != test.want {
			t.Errorf("IsToken(%q) = %v, want %v", test.token, got, test.want)
		}
	}
}

type answer struct {
	name  string
	txt   []string
	cname string
}

type reply struct {
	rcode         dnsmessage.RCode
	authoritative bool
	recursion     bool
	truncated     bool
	answers       []answer
}

func authoritative(answers ...answer) reply {
	return reply{authoritative: true, answers: answers}
}

func txt(name string, values ...string) answer {
	return answer{name: name, txt: values}
}

const recordName = "_vetchium.acme.example."

func TestCheckResults(t *testing.T) {
	t.Parallel()
	want := RecordValue(testToken)
	for _, test := range []struct {
		name    string
		reply   reply
		want    Result
		wantErr bool
	}{
		{name: "matching value", reply: authoritative(txt(recordName, want)),
			want: Present},
		{name: "matching value among others", reply: authoritative(
			txt(recordName, "v=spf1 -all"),
			txt(recordName, "vetchium-verify=other"),
			txt(recordName, want),
		), want: Present},
		{name: "multi-string record is concatenated", reply: authoritative(
			txt(recordName, "vetchium-verify=", testToken[:10], testToken[10:]),
		), want: Present},
		{name: "owner name case is ignored", reply: authoritative(
			txt(strings.ToUpper(recordName), want),
		), want: Present},
		{name: "recursive answer through CNAME", reply: reply{
			recursion: true,
			answers: []answer{
				{name: recordName, cname: "verify.dns-host.example."},
				txt("verify.dns-host.example.", want),
			},
		}, want: Present},
		{name: "strings split across records do not combine", reply: authoritative(
			txt(recordName, "vetchium-verify="),
			txt(recordName, testToken),
		), want: Absent},
		{name: "mismatched value", reply: authoritative(
			txt(recordName, "vetchium-verify=bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		), want: Absent},
		{name: "value with surrounding text", reply: authoritative(
			txt(recordName, want+" "),
		), want: Absent},
		{name: "value at another name", reply: authoritative(
			txt("acme.example.", want),
		), want: Absent},
		{name: "no TXT data", reply: authoritative(), want: Absent},
		{name: "authoritative NXDOMAIN", reply: reply{
			rcode: dnsmessage.RCodeNameError, authoritative: true,
		}, want: Absent},
		{name: "recursive NXDOMAIN", reply: reply{
			rcode: dnsmessage.RCodeNameError, recursion: true,
		}, want: Absent},
		{name: "lame referral", reply: reply{}, want: Inconclusive,
			wantErr: true},
		{name: "NXDOMAIN from a lame server", reply: reply{
			rcode: dnsmessage.RCodeNameError,
		}, want: Inconclusive, wantErr: true},
		{name: "SERVFAIL", reply: reply{
			rcode: dnsmessage.RCodeServerFailure, recursion: true,
		}, want: Inconclusive, wantErr: true},
		{name: "REFUSED", reply: reply{
			rcode: dnsmessage.RCodeRefused, authoritative: true,
			answers: []answer{txt(recordName, want)},
		}, want: Inconclusive, wantErr: true},
		{name: "FORMERR", reply: reply{
			rcode: dnsmessage.RCodeFormatError, recursion: true,
		}, want: Inconclusive, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			address := startServer(t, test.reply, false)
			got, err := New(address, 2*time.Second).Check(
				t.Context(), "acme.example", testToken,
			)
			if got != test.want || (err != nil) != test.wantErr {
				t.Fatalf("Check() = %q, %v; want %q, error %v",
					got, err, test.want, test.wantErr)
			}
		})
	}
}

func TestCheckRetriesTruncatedAnswerOverTCP(t *testing.T) {
	t.Parallel()
	address := startServer(
		t, authoritative(txt(recordName, RecordValue(testToken))), true,
	)
	got, err := New(address, 2*time.Second).Check(
		t.Context(), "acme.example", testToken,
	)
	if got != Present || err != nil {
		t.Fatalf("Check() = %q, %v; want present", got, err)
	}
}

func TestCheckTimesOut(t *testing.T) {
	t.Parallel()
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	started := time.Now()
	got, err := New(conn.LocalAddr().String(), 100*time.Millisecond).Check(
		t.Context(), "acme.example", testToken,
	)
	if got != Inconclusive || err == nil {
		t.Fatalf("Check() = %q, %v; want inconclusive with error", got, err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("Check() took %s, want it bounded by the timeout", elapsed)
	}
}

func TestCheckHonorsCallerCancellation(t *testing.T) {
	t.Parallel()
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	ctx, cancel := context.WithCancel(t.Context())
	time.AfterFunc(50*time.Millisecond, cancel)
	got, err := New(conn.LocalAddr().String(), time.Minute).Check(
		ctx, "acme.example", testToken,
	)
	if got != Inconclusive || !errors.Is(err, context.Canceled) {
		t.Fatalf("Check() = %q, %v; want inconclusive after cancellation",
			got, err)
	}
}

func TestCheckIgnoresMismatchedResponses(t *testing.T) {
	t.Parallel()
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	go func() {
		buffer := make([]byte, 65535)
		n, from, err := conn.ReadFrom(buffer)
		if err != nil {
			return
		}
		var query dnsmessage.Message
		if query.Unpack(buffer[:n]) != nil {
			return
		}
		present := authoritative(txt(recordName, RecordValue(testToken)))
		forged := query
		forged.ID++
		_, _ = conn.WriteTo(pack(forged, present), from)
		other := query
		other.Questions = []dnsmessage.Question{{
			Name:  dnsmessage.MustNewName("other.example."),
			Type:  dnsmessage.TypeTXT,
			Class: dnsmessage.ClassINET,
		}}
		_, _ = conn.WriteTo(pack(other, present), from)
		_, _ = conn.WriteTo(pack(query, authoritative()), from)
	}()

	got, err := New(conn.LocalAddr().String(), 2*time.Second).Check(
		t.Context(), "acme.example", testToken,
	)
	if got != Absent || err != nil {
		t.Fatalf("Check() = %q, %v; want the genuine absent answer", got, err)
	}
}

func TestCheckRejectsBadInput(t *testing.T) {
	t.Parallel()
	checker := New("127.0.0.1:1", time.Second)
	for _, test := range []struct{ domain, token string }{
		{"acme.example", ""},
		{"acme.example", "not-a-token"},
		{strings.Repeat("a.", 130) + "example", testToken},
	} {
		got, err := checker.Check(t.Context(), test.domain, test.token)
		if got != Inconclusive || err == nil {
			t.Errorf("Check(%q, %q) = %q, %v; want inconclusive with error",
				test.domain, test.token, got, err)
		}
	}
}

func TestCheckUnreachableResolver(t *testing.T) {
	t.Parallel()
	got, err := New("127.0.0.1:0", time.Second).Check(
		t.Context(), "acme.example", testToken,
	)
	if got != Inconclusive || err == nil {
		t.Fatalf("Check() = %q, %v; want inconclusive with error", got, err)
	}
}

// startServer answers every query with reply. When truncateUDP is set, UDP
// answers carry only the TC bit and the full reply is served over TCP on the
// same port, as a real server does for an answer too large for UDP.
func startServer(t *testing.T, r reply, truncateUDP bool) string {
	t.Helper()
	var packetConn net.PacketConn
	var listener net.Listener
	for attempt := 0; ; attempt++ {
		conn, err := net.ListenPacket("udp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		if !truncateUDP {
			packetConn = conn
			break
		}
		listener, err = net.Listen("tcp", conn.LocalAddr().String())
		if err == nil {
			packetConn = conn
			break
		}
		_ = conn.Close()
		if attempt == 20 {
			t.Fatalf("no port free for both UDP and TCP: %v", err)
		}
	}
	t.Cleanup(func() { _ = packetConn.Close() })

	go func() {
		buffer := make([]byte, 65535)
		for {
			n, from, err := packetConn.ReadFrom(buffer)
			if err != nil {
				return
			}
			var query dnsmessage.Message
			if query.Unpack(buffer[:n]) != nil {
				continue
			}
			udpReply := r
			if truncateUDP {
				udpReply = reply{authoritative: true, truncated: true}
			}
			_, _ = packetConn.WriteTo(pack(query, udpReply), from)
		}
	}()
	if listener != nil {
		t.Cleanup(func() { _ = listener.Close() })
		go serveTCP(listener, r)
	}
	return packetConn.LocalAddr().String()
}

func serveTCP(listener net.Listener, r reply) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go func() {
			defer func() { _ = conn.Close() }()
			var length [2]byte
			if _, err := io.ReadFull(conn, length[:]); err != nil {
				return
			}
			packet := make([]byte, binary.BigEndian.Uint16(length[:]))
			if _, err := io.ReadFull(conn, packet); err != nil {
				return
			}
			var query dnsmessage.Message
			if query.Unpack(packet) != nil {
				return
			}
			response := pack(query, r)
			framed := binary.BigEndian.AppendUint16(nil, uint16(len(response)))
			_, _ = conn.Write(append(framed, response...))
		}()
	}
}

// pack drops a response it cannot encode; the query then times out and the
// test fails on its result rather than from a server goroutine.
func pack(query dnsmessage.Message, r reply) []byte {
	response := dnsmessage.Message{
		Header: dnsmessage.Header{
			ID:                 query.ID,
			Response:           true,
			Authoritative:      r.authoritative,
			RecursionDesired:   query.RecursionDesired,
			RecursionAvailable: r.recursion,
			Truncated:          r.truncated,
			RCode:              r.rcode,
		},
		Questions: query.Questions,
	}
	for _, a := range r.answers {
		header := dnsmessage.ResourceHeader{
			Name:  dnsmessage.MustNewName(a.name),
			Class: dnsmessage.ClassINET,
			TTL:   60,
		}
		if a.cname != "" {
			response.Answers = append(response.Answers, dnsmessage.Resource{
				Header: header,
				Body: &dnsmessage.CNAMEResource{
					CNAME: dnsmessage.MustNewName(a.cname),
				},
			})
			continue
		}
		response.Answers = append(response.Answers, dnsmessage.Resource{
			Header: header, Body: &dnsmessage.TXTResource{TXT: a.txt},
		})
	}
	packed, _ := response.Pack()
	return packed
}
