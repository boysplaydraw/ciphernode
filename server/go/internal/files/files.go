package files

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/boysplaydraw/ciphernode/server/go/internal/storage"
)

var ErrTooLarge = errors.New("file too large")

type Service struct {
	store        storage.Store
	maxBytes     int64
	maxDownloads int
}

type UploadRequest struct {
	Name          string `json:"name"`
	Size          int64  `json:"size"`
	MimeType      string `json:"mimeType"`
	EncryptedData string `json:"encryptedData"`
	UploadedBy    string `json:"uploadedBy"`
	MaxDownloads  int    `json:"maxDownloads,omitempty"`
}

func NewService(store storage.Store, maxBytes int64, maxDownloads int) *Service {
	return &Service{store: store, maxBytes: maxBytes, maxDownloads: maxDownloads}
}

func (s *Service) Upload(req UploadRequest, ttl time.Duration) (storage.SharedFile, error) {
	estimated := int64(float64(len(req.EncryptedData)) * 0.75)
	if estimated > s.maxBytes {
		return storage.SharedFile{}, ErrTooLarge
	}
	if req.Size > 0 {
		estimated = req.Size
	}
	maxDownloads := req.MaxDownloads
	if maxDownloads <= 0 {
		maxDownloads = s.maxDownloads
	}
	file := storage.SharedFile{
		ID:            "file_" + randomHex(12),
		Name:          req.Name,
		Size:          estimated,
		MimeType:      fallback(req.MimeType, "application/octet-stream"),
		EncryptedData: req.EncryptedData,
		UploadedBy:    req.UploadedBy,
		ExpiresAt:     time.Now().Add(ttl).UnixMilli(),
		MaxDownloads:  maxDownloads,
	}
	s.store.SaveFile(file)
	return file, nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(b)
}

func fallback(v, fb string) string {
	if v == "" {
		return fb
	}
	return v
}
