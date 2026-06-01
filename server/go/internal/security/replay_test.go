package security

import (
	"errors"
	"testing"
	"time"
)

func TestReplayProtectorRejectsDuplicateNonce(t *testing.T) {
	r := NewReplayProtector(time.Hour, time.Minute)
	ts := time.Now().UnixMilli()
	if err := r.Check("n1", ts); err != nil {
		t.Fatal(err)
	}
	if err := r.Check("n1", ts); !errors.Is(err, ErrReplay) {
		t.Fatalf("expected replay error, got %v", err)
	}
}

func TestReplayProtectorRejectsSkew(t *testing.T) {
	r := NewReplayProtector(time.Hour, time.Minute)
	err := r.Check("n1", time.Now().Add(-time.Hour).UnixMilli())
	if !errors.Is(err, ErrTimestampSkew) {
		t.Fatalf("expected skew error, got %v", err)
	}
}
