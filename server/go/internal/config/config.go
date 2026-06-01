package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Host               string
	Port               string
	MessageTTL         time.Duration
	FileTTL            time.Duration
	ReplayTTL          time.Duration
	TimestampSkew      time.Duration
	ShutdownTimeout    time.Duration
	RateLimitPerMinute int
	MaxFileSizeBytes   int64
	MaxFileDownloads   int
	AllowedOrigins     []string
	OnionAddress       string
}

func Load() Config {
	return Config{
		Host:               getenv("HOST", "0.0.0.0"),
		Port:               getenv("PORT", "5000"),
		MessageTTL:         durationEnv("MESSAGE_TTL", 24*time.Hour),
		FileTTL:            durationEnv("FILE_TTL", 24*time.Hour),
		ReplayTTL:          durationEnv("REPLAY_TTL", time.Hour),
		TimestampSkew:      durationEnv("TIMESTAMP_SKEW", 5*time.Minute),
		ShutdownTimeout:    durationEnv("SHUTDOWN_TIMEOUT", 10*time.Second),
		RateLimitPerMinute: intEnv("RATE_LIMIT_PER_MINUTE", 120),
		MaxFileSizeBytes:   int64(intEnv("MAX_FILE_SIZE_MB", 100)) * 1024 * 1024,
		MaxFileDownloads:   intEnv("MAX_FILE_DOWNLOADS", 10),
		AllowedOrigins:     splitEnv("ALLOWED_ORIGINS", "*"),
		OnionAddress:       getenv("ONION_ADDRESS", ""),
	}
}

func (c Config) Addr() string {
	return fmt.Sprintf("%s:%s", c.Host, c.Port)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func intEnv(key string, fallback int) int {
	v, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return v
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err == nil {
		return d
	}
	ms, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return time.Duration(ms) * time.Millisecond
}

func splitEnv(key, fallback string) []string {
	raw := getenv(key, fallback)
	if raw == "*" {
		return []string{"*"}
	}
	var out []string
	start := 0
	for i := 0; i <= len(raw); i++ {
		if i == len(raw) || raw[i] == ',' {
			if start < i {
				out = append(out, raw[start:i])
			}
			start = i + 1
		}
	}
	return out
}
