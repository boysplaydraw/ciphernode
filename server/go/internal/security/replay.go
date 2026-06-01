package security

import (
	"errors"
	"sync"
	"time"
)

var (
	ErrReplay          = errors.New("replayed nonce")
	ErrTimestampSkew   = errors.New("timestamp outside allowed skew")
	ErrMissingSecurity = errors.New("missing nonce or timestamp")
)

type ReplayProtector struct {
	mu    sync.Mutex
	seen  map[string]time.Time
	ttl   time.Duration
	skew  time.Duration
	nowFn func() time.Time
}

func NewReplayProtector(ttl, skew time.Duration) *ReplayProtector {
	return &ReplayProtector{seen: map[string]time.Time{}, ttl: ttl, skew: skew, nowFn: time.Now}
}

func (r *ReplayProtector) Check(nonce string, timestampMs int64) error {
	if nonce == "" || timestampMs == 0 {
		return nil
	}
	now := r.nowFn()
	ts := time.UnixMilli(timestampMs)
	if ts.Before(now.Add(-r.skew)) || ts.After(now.Add(r.skew)) {
		return ErrTimestampSkew
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for k, t := range r.seen {
		if now.Sub(t) > r.ttl {
			delete(r.seen, k)
		}
	}
	if _, ok := r.seen[nonce]; ok {
		return ErrReplay
	}
	r.seen[nonce] = now
	return nil
}
