package protocol

import (
	"encoding/json"
	"errors"
	"time"
)

type Envelope struct {
	Event     string          `json:"event"`
	Data      json.RawMessage `json:"data,omitempty"`
	RequestID string          `json:"requestId,omitempty"`
	Nonce     string          `json:"nonce,omitempty"`
	Timestamp int64           `json:"timestamp,omitempty"`
}

type Outbound struct {
	Event     string `json:"event"`
	Data      any    `json:"data,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	Error     string `json:"error,omitempty"`
}

type Register struct {
	UserID     string   `json:"userId"`
	PublicKey  string   `json:"publicKey,omitempty"`
	TorEnabled bool     `json:"torEnabled,omitempty"`
	Groups     []string `json:"groups,omitempty"`
}

type DirectMessage struct {
	ID        string `json:"id,omitempty"`
	To        string `json:"to"`
	From      string `json:"from"`
	Encrypted string `json:"encrypted"`
	P2POnly   bool   `json:"p2pOnly,omitempty"`
}

type GroupMessage struct {
	ID        string `json:"id,omitempty"`
	GroupID   string `json:"groupId"`
	From      string `json:"from"`
	Encrypted string `json:"encrypted"`
	Content   string `json:"content,omitempty"`
}

type FileShare struct {
	To           string `json:"to"`
	From         string `json:"from"`
	FileID       string `json:"fileId"`
	FileName     string `json:"fileName"`
	FileSize     int64  `json:"fileSize"`
	MimeType     string `json:"mimeType"`
	EncryptedKey string `json:"encryptedKey"`
	Timestamp    int64  `json:"timestamp,omitempty"`
}

func Decode(data []byte) (Envelope, error) {
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return env, err
	}
	if env.Event == "" {
		return env, errors.New("missing event")
	}
	return env, nil
}

func Unmarshal[T any](raw json.RawMessage) (T, error) {
	var v T
	err := json.Unmarshal(raw, &v)
	return v, err
}

func NowMillis() int64 {
	return time.Now().UnixMilli()
}
