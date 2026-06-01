package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Global variables for server configurations and memory storage
var (
	upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins for local, Tor, Docker & ngrok
		},
	}

	// Thread-safe memory stores mirroring Node.js structures
	connectedUsers = make(map[string]*ClientConn) // userId -> ClientConn
	connectedMutex sync.RWMutex

	pendingMessages = make(map[string][]PendingMsg) // userId -> []PendingMsg
	pendingMutex    sync.RWMutex

	sharedFiles = make(map[string]*SharedFileRecord) // fileId -> SharedFileRecord
	filesMutex  sync.RWMutex

	groups = make(map[string]*GroupRecord) // groupId -> GroupRecord
	groupsMutex sync.RWMutex

	// Matching queue & sessions
	matchingQueue = make(map[string]*MatchingUserRecord) // userId -> MatchingUserRecord
	matchMutex    sync.RWMutex

	deliveredMessageIds = make(map[string]time.Time) // msgId -> timestamp
	deliveredMutex      sync.Mutex

	scanner         *AntiGravitiScanner
	securityManager *SecurityManager
)

// Data Models matching client-server protocol
type PendingMsg struct {
	ID        string `json:"id"`
	From      string `json:"from"`
	To        string `json:"to"`
	Encrypted string `json:"encrypted"`
	Timestamp int64  `json:"timestamp"`
	GroupID   string `json:"groupId,omitempty"`
	Content   string `json:"content,omitempty"`
}

type SharedFileRecord struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Size          int64     `json:"size"`
	MimeType      string    `json:"mimeType"`
	EncryptedData string    `json:"encryptedData"`
	UploadedBy    string    `json:"uploadedBy"`
	ExpiresAt     int64     `json:"expiresAt"`
	DownloadCount int       `json:"downloadCount"`
	MaxDownloads  int       `json:"maxDownloads"`
}

type GroupRecord struct {
	ID      string   `json:"id"`
	Members []string `json:"members"`
}

type MatchingUserRecord struct {
	UserID   string `json:"userId"`
	SocketID string `json:"socketId"`
	Alias    string `json:"alias"`
	JoinedAt int64  `json:"joinedAt"`
}

// SocketIOChatMessage models a Socket.IO protocol payload
type SocketIOChatMessage struct {
	Event string        `json:"event"`
	Data  interface{}   `json:"data"`
}

// ClientConn wraps individual client websocket connection and status
type ClientConn struct {
	Conn     *websocket.Conn
	UserID   string
	IP       string
	SocketID string
	Mu       sync.Mutex
}

// SendMessage sends JSON to the websocket safely
func (cc *ClientConn) SendMessage(event string, data interface{}) error {
	cc.Mu.Lock()
	defer cc.Mu.Unlock()

	// Socket.IO wire protocol formatting for raw WS:
	// We'll transmit custom JSON structures that the React Native client's socket-wrapper parses.
	// Since our React Native client uses standard socket.io-client, if we are running raw websocket,
	// we will format as Socket.IO payload: `42["event", data]`
	payload := []interface{}{event, data}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	// Format as a Socket.IO packet "42" + json
	packet := fmt.Sprintf("42%s", string(jsonBytes))
	return cc.Conn.WriteMessage(websocket.TextMessage, []byte(packet))
}

func main() {
	// Initialize subsystems
	scanner = NewAntiGravitiScanner("antigraviti")
	securityManager = NewSecurityManager()

	// Register callback to disconnect malicious nodes in real time
	securityManager.RegisterDisconnectCallback(func(nodeID string, ip string) {
		connectedMutex.Lock()
		defer connectedMutex.Unlock()

		for uid, cc := range connectedUsers {
			shouldDrop := false
			if nodeID != "" && uid == nodeID {
				shouldDrop = true
			}
			if ip != "" && cc.IP == ip {
				shouldDrop = true
			}

			if shouldDrop {
				log.Printf("[Security] Terminating active socket connection for Node ID: %s, IP: %s due to threat threat-level detection", uid, cc.IP)
				// Notify client of drop reason
				_ = cc.SendMessage("security:alert", map[string]interface{}{
					"message": "Connection terminated due to critical threat detection by Anti-Graviti network scanner.",
					"action":  "blacklist",
				})
				cc.Conn.Close()
				delete(connectedUsers, uid)
			}
		}
	})

	// Periodic cleanups mirroring TypeScript implementation
	go runPeriodicCleanups()

	// Routes
	http.HandleFunc("/api/health", handleHealth)
	http.HandleFunc("/api/stats", handleStats)
	http.HandleFunc("/api/files/upload", handleFileUpload)
	http.HandleFunc("/api/files/", handleFileDownload) // Handles download & info
	http.HandleFunc("/api/onion-address", handleOnionAddress)
	
	// WebSocket upgrade endpoint (mirrors Socket.IO socket transport endpoint)
	http.HandleFunc("/socket.io/", handleSocketIOUpgrade)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Printf("[Relay] CipherNode Go Security Relay running on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server stopped: %v", err)
	}
}

// REST Handlers
func handleHealth(w http.ResponseWriter, r *http.Request) {
	// Simple JSON response
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ok",
		"timestamp": time.Now().UnixNano() / int64(time.Millisecond),
		"engine":    "Go-Relay-Node v1.0",
	})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	connectedMutex.RLock()
	usersCount := len(connectedUsers)
	connectedMutex.RUnlock()

	pendingMutex.RLock()
	msgsCount := 0
	for _, msgs := range pendingMessages {
		msgsCount += len(msgs)
	}
	pendingMutex.RUnlock()

	blockedIPs, blockedNodes := securityManager.GetStats()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"connectedUsers":  usersCount,
		"pendingMessages": msgsCount,
		"security": map[string]interface{}{
			"blockedIPs":   blockedIPs,
			"blockedNodes": blockedNodes,
		},
	})
}

func handleFileUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name          string `json:"name"`
		Size          int64  `json:"size"`
		MimeType      string `json:"mimeType"`
		EncryptedData string `json:"encryptedData"`
		UploadedBy    string `json:"uploadedBy"`
		MaxDownloads  int    `json:"maxDownloads"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Bad request: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.EncryptedData == "" || req.UploadedBy == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	// 100MB limit check
	estimatedSize := int64(float64(len(req.EncryptedData)) * 0.75)
	if estimatedSize > 100*1024*1024 {
		http.Error(w, "File too large (max 100MB)", http.StatusRequestEntityTooLarge)
		return
	}

	fileId := fmt.Sprintf("file_%d_%012d", time.Now().Unix(), rand.Int63n(1e12))
	expiresAt := time.Now().Add(24 * time.Hour).UnixNano() / int64(time.Millisecond)
	maxDl := req.MaxDownloads
	if maxDl <= 0 {
		maxDl = 10
	}

	record := &SharedFileRecord{
		ID:            fileId,
		Name:          req.Name,
		Size:          estimatedSize,
		MimeType:      req.MimeType,
		EncryptedData: req.EncryptedData,
		UploadedBy:    req.UploadedBy,
		ExpiresAt:     expiresAt,
		DownloadCount: 0,
		MaxDownloads:  maxDl,
	}

	filesMutex.Lock()
	sharedFiles[fileId] = record
	filesMutex.Unlock()

	log.Printf("[Relay] File uploaded: %s (%d bytes)", req.Name, estimatedSize)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"fileId":      fileId,
		"expiresAt":   expiresAt,
		"downloadUrl": fmt.Sprintf("/api/files/%s", fileId),
	})
}

func handleFileDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	fileId := parts[3]
	isInfoRequest := len(parts) > 4 && parts[4] == "info"

	filesMutex.Lock()
	file, exists := sharedFiles[fileId]
	if !exists {
		filesMutex.Unlock()
		http.Error(w, "File not found or expired", http.StatusNotFound)
		return
	}

	if file.DownloadCount >= file.MaxDownloads {
		delete(sharedFiles, fileId)
		filesMutex.Unlock()
		http.Error(w, "File download limit reached", http.StatusGone)
		return
	}

	if !isInfoRequest {
		file.DownloadCount++
	}
	filesMutex.Unlock()

	if isInfoRequest {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"name":               file.Name,
			"size":               file.Size,
			"mimeType":           file.MimeType,
			"expiresAt":          file.ExpiresAt,
			"remainingDownloads": file.MaxDownloads - file.DownloadCount,
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"name":               file.Name,
		"size":               file.Size,
		"mimeType":           file.MimeType,
		"encryptedData":      file.EncryptedData,
		"expiresAt":          file.ExpiresAt,
		"remainingDownloads": file.MaxDownloads - file.DownloadCount,
	})
}

func handleOnionAddress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	onion := os.Getenv("ONION_ADDRESS")
	if onion == "" {
		onion = "ciphernode66test.onion" // Mock placeholder onion
	}
	json.NewEncoder(w).Encode(map[string]string{
		"onionAddress": onion,
	})
}

// WebSocket Upgrade and Session Handler
func handleSocketIOUpgrade(w http.ResponseWriter, r *http.Request) {
	// First check if the IP is blacklisted
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if isBlocked, reason := securityManager.IsIPBlacklisted(ip); isBlocked {
		log.Printf("[Security] Blocking websocket connection request from blacklisted IP: %s (Reason: %s)", ip, reason)
		http.Error(w, "Access Denied: Node is blacklisted due to active security vulnerabilities.", http.StatusForbidden)
		return
	}

	// Check if this is a standard websocket transport request
	if r.URL.Query().Get("transport") != "websocket" {
		// Respond with Socket.IO engine handshake if requested via HTTP polling
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		sid := fmt.Sprintf("sid_%d", time.Now().UnixNano())
		json.NewEncoder(w).Encode(map[string]interface{}{
			"sid":          sid,
			"upgrades":     []string{"websocket"},
			"pingInterval": 25000,
			"pingTimeout":  5000,
		})
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade failure: %v", err)
		return
	}

	socketId := fmt.Sprintf("sock_%d", time.Now().UnixNano())
	clientConn := &ClientConn{
		Conn:     conn,
		IP:       ip,
		SocketID: socketId,
	}

	log.Printf("[WebSocket] Client connected: %s (IP: %s)", socketId, ip)
	
	// Send Socket.IO connection handshake packet (0)
	_ = conn.WriteMessage(websocket.TextMessage, []byte("0{\"sid\":\""+socketId+"\"}"))

	// Manage read loop for socket
	go readSocketLoop(clientConn)

	// Trigger asynchronous security analysis on the newly connected node target
	go runAsynchronousThreatScan(clientConn)
}

// runAsynchronousThreatScan runs security scan in background, ensuring zero impact on main traffic.
func runAsynchronousThreatScan(cc *ClientConn) {
	// Create context with a timeout of 10 seconds to limit runtime of network scans
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	report, err := scanner.ScanTarget(ctx, cc.IP)
	if err != nil {
		log.Printf("[Scanner] Asynchronous scan error on client %s (%s): %v", cc.SocketID, cc.IP, err)
		return
	}

	// Threat response policy: If report has critical vulnerabilities or active cyber threat indicators, block node immediately.
	if report.ThreatLevel == "critical" || report.LeakStatus {
		log.Printf("[Security] CRITICAL THREAT DETECTED on node client %s (%s)! Initiating instant drop...", cc.SocketID, cc.IP)
		
		// 1. Blacklist the IP so it can't reconnect
		securityManager.BlacklistIP(cc.IP, fmt.Sprintf("Anti-Graviti scan detected critical security status (Threat Level: %s)", report.ThreatLevel))
		
		// 2. Blacklist Node ID if client has registered already
		if cc.UserID != "" {
			securityManager.BlacklistNode(cc.UserID, "Critical vulnerabilities active on connecting device")
		}
	}
}

// WebSocket processing logic
func readSocketLoop(cc *ClientConn) {
	defer func() {
		cc.Conn.Close()
		connectedMutex.Lock()
		if cc.UserID != "" {
			delete(connectedUsers, cc.UserID)
		}
		connectedMutex.Unlock()
		
		// Remove from matching queues
		matchMutex.Lock()
		delete(matchingQueue, cc.UserID)
		matchMutex.Unlock()

		log.Printf("[WebSocket] Client disconnected: %s", cc.SocketID)
	}()

	for {
		messageType, dataBytes, err := cc.Conn.ReadMessage()
		if err != nil {
			break
		}

		if messageType != websocket.TextMessage {
			continue
		}

		// Handle Socket.IO heartbeats and packets
		payload := string(dataBytes)
		if payload == "2" {
			// Ping packet -> send Pong (3)
			_ = cc.Conn.WriteMessage(websocket.TextMessage, []byte("3"))
			continue
		}

		// Look for custom payload (42 format representing event arrays)
		if strings.HasPrefix(payload, "42") {
			rawJSON := payload[2:]
			var parsedPayload []json.RawMessage
			if err := json.Unmarshal([]byte(rawJSON), &parsedPayload); err != nil || len(parsedPayload) < 1 {
				continue
			}

			var eventName string
			if err := json.Unmarshal(parsedPayload[0], &eventName); err != nil {
				continue
			}

			handleSocketEvent(cc, eventName, parsedPayload)
		}
	}
}

func handleSocketEvent(cc *ClientConn, event string, args []json.RawMessage) {
	// First check if user/IP is blacklisted (late check)
	if isBlocked, _ := securityManager.IsIPBlacklisted(cc.IP); isBlocked {
		cc.Conn.Close()
		return
	}

	if cc.UserID != "" {
		if isBlocked, _ := securityManager.IsNodeBlacklisted(cc.UserID); isBlocked {
			cc.Conn.Close()
			return
		}
	}

	switch event {
	case "register":
		if len(args) < 2 {
			return
		}
		var registerData struct {
			UserID    string   `json:"userId"`
			PublicKey string   `json:"publicKey"`
			Groups    []string `json:"groups"`
		}

		// Check if it's string format (old fallback) or full JSON object
		var simpleID string
		if err := json.Unmarshal(args[1], &simpleID); err == nil {
			registerData.UserID = simpleID
		} else {
			_ = json.Unmarshal(args[1], &registerData)
		}

		if registerData.UserID == "" {
			return
		}

		// Security: If Node ID was blacklisted, drop connection
		if isBlocked, _ := securityManager.IsNodeBlacklisted(registerData.UserID); isBlocked {
			log.Printf("[Security] Dropping registration from blacklisted Node ID: %s", registerData.UserID)
			cc.Conn.Close()
			return
		}

		cc.UserID = registerData.UserID
		connectedMutex.Lock()
		connectedUsers[cc.UserID] = cc
		connectedMutex.Unlock()

		log.Printf("[WebSocket] User registered: %s (IP: %s)", cc.UserID, cc.IP)
		_ = cc.SendMessage("registered", nil)

		// Check for offline messages
		pendingMutex.Lock()
		pending, hasPending := pendingMessages[cc.UserID]
		if hasPending && len(pending) > 0 {
			for _, msg := range pending {
				if msg.GroupID != "" {
					_ = cc.SendMessage("group:message", msg)
				} else {
					_ = cc.SendMessage("message", msg)
				}
			}
			delete(pendingMessages, cc.UserID)
			log.Printf("[WebSocket] Delivered %d pending offline messages to user: %s", len(pending), cc.UserID)
		}
		pendingMutex.Unlock()

	case "message":
		if len(args) < 2 {
			return
		}
		var msg struct {
			ID        string `json:"id"`
			To        string `json:"to"`
			From      string `json:"from"`
			Encrypted string `json:"encrypted"`
			P2POnly   bool   `json:"p2pOnly"`
		}
		if err := json.Unmarshal(args[1], &msg); err != nil {
			return
		}

		if msg.ID == "" {
			msg.ID = fmt.Sprintf("msg_%d_%d", time.Now().UnixNano(), rand.Intn(1000))
		}

		// Ignore duplicates
		deliveredMutex.Lock()
		if _, seen := deliveredMessageIds[msg.ID]; seen {
			deliveredMutex.Unlock()
			return
		}
		deliveredMessageIds[msg.ID] = time.Now()
		deliveredMutex.Unlock()

		connectedMutex.RLock()
		targetConn, online := connectedUsers[msg.To]
		connectedMutex.RUnlock()

		timestamp := time.Now().UnixNano() / int64(time.Millisecond)

		if online {
			_ = targetConn.SendMessage("message", map[string]interface{}{
				"id":        msg.ID,
				"from":      msg.From,
				"encrypted": msg.Encrypted,
				"timestamp": timestamp,
			})
			log.Printf("[Message] Direct delivery: %s -> %s", msg.From, msg.To)
		} else if !msg.P2POnly {
			// Save in pending queue
			pendingMutex.Lock()
			q := pendingMessages[msg.To]
			q = append(q, PendingMsg{
				ID:        msg.ID,
				From:      msg.From,
				To:        msg.To,
				Encrypted: msg.Encrypted,
				Timestamp: timestamp,
			})
			pendingMessages[msg.To] = q
			pendingMutex.Unlock()
			log.Printf("[Message] Queued offline message for: %s", msg.To)
		}

	case "webrtc:offer", "webrtc:answer", "webrtc:ice":
		// Direct WebRTC signaling relay (server does not inspect contents)
		if len(args) < 2 {
			return
		}
		var signal struct {
			PeerID    string      `json:"peerId"`
			From      string      `json:"from"`
			Sdp       interface{} `json:"sdp"`
			Candidate interface{} `json:"candidate"`
		}
		if err := json.Unmarshal(args[1], &signal); err != nil {
			return
		}

		connectedMutex.RLock()
		peer, online := connectedUsers[signal.PeerID]
		connectedMutex.RUnlock()

		if online {
			payload := map[string]interface{}{
				"peerId": signal.From,
			}
			if event == "webrtc:ice" {
				payload["candidate"] = signal.Candidate
			} else {
				payload["sdp"] = signal.Sdp
			}
			_ = peer.SendMessage(event, payload)
		}

	case "group:create":
		if len(args) < 2 {
			return
		}
		var g struct {
			GroupID string   `json:"groupId"`
			Members []string `json:"members"`
		}
		if err := json.Unmarshal(args[1], &g); err != nil {
			return
		}

		groupsMutex.Lock()
		groups[g.GroupID] = &GroupRecord{
			ID:      g.GroupID,
			Members: g.Members,
		}
		groupsMutex.Unlock()
		log.Printf("[Group] Group created: %s with %d members", g.GroupID, len(g.Members))

	case "group:message":
		if len(args) < 2 {
			return
		}
		var gm struct {
			ID        string `json:"id"`
			GroupID   string `json:"groupId"`
			From      string `json:"from"`
			Encrypted string `json:"encrypted"`
			Content   string `json:"content"`
		}
		if err := json.Unmarshal(args[1], &gm); err != nil {
			return
		}

		if gm.ID == "" {
			gm.ID = fmt.Sprintf("gmsg_%d_%d", time.Now().UnixNano(), rand.Intn(1000))
		}

		groupsMutex.RLock()
		group, found := groups[gm.GroupID]
		groupsMutex.RUnlock()

		timestamp := time.Now().UnixNano() / int64(time.Millisecond)

		if found {
			for _, m := range group.Members {
				if m == gm.From {
					continue
				}

				connectedMutex.RLock()
				memberConn, online := connectedUsers[m]
				connectedMutex.RUnlock()

				payload := map[string]interface{}{
					"id":        gm.ID,
					"groupId":   gm.GroupID,
					"from":      gm.From,
					"encrypted": gm.Encrypted,
					"content":   gm.Content,
					"timestamp": timestamp,
				}

				if online {
					_ = memberConn.SendMessage("group:message", payload)
				} else {
					pendingMutex.Lock()
					q := pendingMessages[m]
					q = append(q, PendingMsg{
						ID:        gm.ID,
						From:      gm.From,
						To:        m,
						Encrypted: gm.Encrypted,
						Timestamp: timestamp,
						GroupID:   gm.GroupID,
						Content:   gm.Content,
					})
					pendingMessages[m] = q
					pendingMutex.Unlock()
				}
			}
			log.Printf("[Group] Message delivered for group %s from %s", gm.GroupID, gm.From)
		}
	}
}

// runPeriodicCleanups runs background maintenance loops.
func runPeriodicCleanups() {
	ticker := time.NewTicker(15 * time.Minute)
	for range ticker.C {
		now := time.Now().UnixNano() / int64(time.Millisecond)
		
		// 1. Cleanup expired shared files
		filesMutex.Lock()
		for fid, file := range sharedFiles {
			if now > file.ExpiresAt || file.DownloadCount >= file.MaxDownloads {
				delete(sharedFiles, fid)
				log.Printf("[Cleanup] Expired file removed: %s", fid)
			}
		}
		filesMutex.Unlock()

		// 2. Cleanup delivered message history limits
		deliveredMutex.Lock()
		for mid, t := range deliveredMessageIds {
			if time.Since(t) > 1*time.Hour {
				delete(deliveredMessageIds, mid)
			}
		}
		deliveredMutex.Unlock()
	}
}
