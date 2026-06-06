package http

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
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
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "timestamp": time.Now().UnixMilli(), "connections": hub.ConnectedCount(), "metrics": hub.Metrics()})
	})
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "timestamp": time.Now().UnixMilli(), "connections": hub.ConnectedCount(), "metrics": hub.Metrics()})
	})
	mux.HandleFunc("/api/stats", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"storage": store.Stats(hub.ConnectedCount()), "connections": hub.ConnectedCount(), "metrics": hub.Metrics()})
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
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadRequestBytes(cfg.MaxFileSizeBytes))
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
	registerStaticRoutes(mux)
	return securityHeaders(cors(mux, cfg))
}

func registerStaticRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/app", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/app/", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/app/", serveSPA("dist", "/app/"))
	mux.HandleFunc("/privacy", serveNamedFile("website/privacy.html"))
	mux.HandleFunc("/terms", serveNamedFile("website/terms.html"))
	mux.HandleFunc("/relayworks", serveNamedFile("website/relayworks.html"))
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir("assets"))))
	mux.Handle("/website/", http.StripPrefix("/website/", http.FileServer(http.Dir("website"))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		serveNamedFile("website/index.html")(w, r)
	})
}

func serveSPA(root string, prefix string) http.HandlerFunc {
	fileServer := http.StripPrefix(prefix, http.FileServer(http.Dir(root)))
	index := filepath.Join(root, "index.html")
	return func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, prefix)
		if rel == "" {
			http.ServeFile(w, r, index)
			return
		}
		target := filepath.Clean(filepath.Join(root, rel))
		rootClean := filepath.Clean(root)
		if target == rootClean || strings.HasPrefix(target, rootClean+string(os.PathSeparator)) {
			if info, err := os.Stat(target); err == nil && !info.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		http.ServeFile(w, r, index)
	}
}

func serveNamedFile(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(name); err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, name)
	}
}

func maxUploadRequestBytes(maxFileBytes int64) int64 {
	const metadataAllowance = 1024 * 1024
	return maxFileBytes*4/3 + metadataAllowance
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-DNS-Prefetch-Control", "off")
		w.Header().Set("X-Download-Options", "noopen")
		w.Header().Set("X-Permitted-Cross-Domain-Policies", "none")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		}
		next.ServeHTTP(w, r)
	})
}

func cors(next http.Handler, cfg config.Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !allowedOrigin(origin, r.Host, cfg.AllowedOrigins) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,bypass-tunnel-reminder,X-Tor-Enabled,X-Tor-Proxy")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func allowedOrigin(origin string, requestHost string, allowlist []string) bool {
	for _, allowed := range allowlist {
		allowed = strings.TrimSpace(allowed)
		if allowed == "*" || allowed == origin {
			return true
		}
	}

	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}

	host := parsed.Hostname()
	requestHostname := requestHost
	if h, _, err := net.SplitHostPort(requestHostname); err == nil {
		requestHostname = h
	}

	return host == requestHostname ||
		host == "localhost" ||
		host == "127.0.0.1" ||
		host == "::1" ||
		strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".onion")
}
