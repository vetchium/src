package globalcoordinator

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"
)

const (
	shortIDAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"
	shortIDLength   = 11
	sequenceBits    = 10
	maxCounter      = (uint64(1) << 55) - 1
)

var shortIDEpoch = time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)

type Generator struct {
	mu        sync.Mutex
	statePath string
	lockFile  *os.File
	last      uint64
	now       func() time.Time
}

func OpenGenerator(statePath string) (*Generator, error) {
	return openGenerator(statePath, time.Now)
}

func openGenerator(statePath string, now func() time.Time) (*Generator, error) {
	directory := filepath.Dir(statePath)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create short ID state directory: %w", err)
	}
	lockFile, err := os.OpenFile(statePath+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open short ID state lock: %w", err)
	}
	if err := unix.Flock(int(lockFile.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = lockFile.Close()
		return nil, fmt.Errorf("lock short ID state: %w", err)
	}
	last, err := readState(statePath)
	if err != nil {
		_ = unix.Flock(int(lockFile.Fd()), unix.LOCK_UN)
		_ = lockFile.Close()
		return nil, err
	}
	return &Generator{
		statePath: statePath,
		lockFile:  lockFile,
		last:      last,
		now:       now,
	}, nil
}

func (g *Generator) Close() error {
	if g.lockFile == nil {
		return nil
	}
	unlockErr := unix.Flock(int(g.lockFile.Fd()), unix.LOCK_UN)
	closeErr := g.lockFile.Close()
	g.lockFile = nil
	return errors.Join(unlockErr, closeErr)
}

func (g *Generator) Generate() (coordinatorspec.ShortID, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	milliseconds := g.now().UTC().UnixMilli() - shortIDEpoch.UnixMilli()
	if milliseconds < 0 {
		return "", fmt.Errorf("system clock precedes short ID epoch")
	}
	candidate := uint64(milliseconds) << sequenceBits
	if candidate <= g.last {
		candidate = g.last + 1
	}
	if candidate > maxCounter {
		return "", fmt.Errorf("short ID counter exhausted")
	}
	if err := writeState(g.statePath, candidate); err != nil {
		return "", err
	}
	g.last = candidate
	return coordinatorspec.ShortID(encodeShortID(candidate)), nil
}

func readState(path string) (uint64, error) {
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read short ID state: %w", err)
	}
	value, err := strconv.ParseUint(strings.TrimSpace(string(contents)), 10, 55)
	if err != nil {
		return 0, fmt.Errorf("parse short ID state: %w", err)
	}
	return value, nil
}

func writeState(path string, value uint64) error {
	temporaryPath := path + ".tmp"
	file, err := os.OpenFile(
		temporaryPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600,
	)
	if err != nil {
		return fmt.Errorf("open temporary short ID state: %w", err)
	}
	removeTemporary := true
	defer func() {
		_ = file.Close()
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := fmt.Fprintf(file, "%d\n", value); err != nil {
		return fmt.Errorf("write short ID state: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync short ID state: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close short ID state: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace short ID state: %w", err)
	}
	removeTemporary = false
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return fmt.Errorf("open short ID state directory: %w", err)
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return fmt.Errorf("sync short ID state directory: %w", err)
	}
	if err := directory.Close(); err != nil {
		return fmt.Errorf("close short ID state directory: %w", err)
	}
	return nil
}

func encodeShortID(value uint64) string {
	encoded := [shortIDLength]byte{}
	for index := len(encoded) - 1; index >= 0; index-- {
		encoded[index] = shortIDAlphabet[value&31]
		value >>= 5
	}
	return string(encoded[:])
}
