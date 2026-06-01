package storage

import (
	"testing"
	"time"
)

func TestMemoryPendingPop(t *testing.T) {
	s := NewMemory(Options{MessageTTL: time.Hour, FileTTL: time.Hour})
	s.AddPending("b", PendingMessage{ID: "1", To: "b"})
	if got := len(s.PopPending("b")); got != 1 {
		t.Fatalf("got %d pending", got)
	}
	if got := len(s.PopPending("b")); got != 0 {
		t.Fatalf("pending should be empty, got %d", got)
	}
}

func TestMemoryCleanup(t *testing.T) {
	s := NewMemory(Options{MessageTTL: time.Millisecond, FileTTL: time.Millisecond})
	s.AddPending("b", PendingMessage{ID: "old", Timestamp: time.Now().Add(-time.Hour).UnixMilli()})
	s.Cleanup(time.Now())
	if stats := s.Stats(0); stats.PendingMessages != 0 {
		t.Fatalf("expected cleanup, got %+v", stats)
	}
}
