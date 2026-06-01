package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/boysplaydraw/ciphernode/server/go/internal/config"
	"github.com/boysplaydraw/ciphernode/server/go/internal/files"
	"github.com/boysplaydraw/ciphernode/server/go/internal/storage"
	"github.com/boysplaydraw/ciphernode/server/go/internal/ws"
)

func NewRouter(cfg config.Config, store storage.Store, fileSvc *files.Service, hub *ws.Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "timestamp": time.Now().UnixMilli()})
	})
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "timestamp": time.Now().UnixMilli()})
	})
	mux.HandleFunc("/api/stats", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Stats(hub.ConnectedCount()))
	})
	mux.HandleFunc("/api/users/", func(w http.ResponseWriter, r *http.Request) {
		userID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/users/"), "/publickey")
		if userID == "" || !strings.HasSuffix(r.URL.Path, "/publickey") {
			http.NotFound(w, r)
			return
		}
		key, ok := store.GetPublicKey(userID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found or has never connected"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"publicKey": key})
	})
	mux.HandleFunc("/api/files/upload", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req files.UploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.EncryptedData == "" || req.UploadedBy == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing required fields"})
			return
		}
		file, err := fileSvc.Upload(req, cfg.FileTTL)
		if err == files.ErrTooLarge {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "File too large"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"fileId": file.ID, "expiresAt": file.ExpiresAt, "downloadUrl": "/api/files/" + file.ID})
	})
	mux.HandleFunc("/api/files/", func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/api/files/")
		fileID := strings.TrimSuffix(rest, "/info")
		infoOnly := strings.HasSuffix(rest, "/info")
		file, ok := store.GetFile(fileID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "File not found or expired"})
			return
		}
		if file.DownloadCount >= file.MaxDownloads {
			store.DeleteFile(fileID)
			writeJSON(w, http.StatusGone, map[string]string{"error": "File download limit reached"})
			return
		}
		if !infoOnly {
			file.DownloadCount++
			store.UpdateFile(file)
		}
		resp := map[string]any{"name": file.Name, "size": file.Size, "mimeType": file.MimeType, "expiresAt": file.ExpiresAt, "remainingDownloads": file.MaxDownloads - file.DownloadCount}
		if !infoOnly {
			resp["encryptedData"] = file.EncryptedData
		}
		writeJSON(w, http.StatusOK, resp)
	})
	mux.HandleFunc("/api/onion-address", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"onionAddress": cfg.OnionAddress})
	})
	mux.HandleFunc("/ws", hub.ServeWS)
	return cors(mux)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,bypass-tunnel-reminder,X-Tor-Enabled,X-Tor-Proxy")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}
