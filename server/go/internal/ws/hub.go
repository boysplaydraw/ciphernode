package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/boysplaydraw/ciphernode/server/go/internal/protocol"
	"github.com/boysplaydraw/ciphernode/server/go/internal/ratelimit"
	"github.com/boysplaydraw/ciphernode/server/go/internal/security"
	"github.com/boysplaydraw/ciphernode/server/go/internal/storage"
)

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan protocol.Outbound
	userID string
	ip     string
}

type Hub struct {
	store   storage.Store
	replay  *security.ReplayProtector
	limits  *ratelimit.Limiter
	mu      sync.RWMutex
	clients map[string]*Client
	done    chan struct{}
}

func NewHub(store storage.Store, replay *security.ReplayProtector, limits *ratelimit.Limiter) *Hub {
	return &Hub{store: store, replay: replay, limits: limits, clients: map[string]*Client{}, done: make(chan struct{})}
}

func (h *Hub) Run() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			h.store.Cleanup(time.Now())
		case <-h.done:
			return
		}
	}
}

func (h *Hub) Close() {
	close(h.done)
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, c := range h.clients {
		_ = c.conn.Close()
	}
}

func (h *Hub) ConnectedCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade failed: %v", err)
		return
	}
	client := &Client{hub: h, conn: conn, send: make(chan protocol.Outbound, 32), ip: r.RemoteAddr}
	go client.writeLoop()
	client.readLoop()
}

func (c *Client) readLoop() {
	defer c.close()
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		env, err := protocol.Decode(data)
		if err != nil {
			c.emit(protocol.Outbound{Event: "error", Error: err.Error()})
			continue
		}
		if !c.hub.limits.Allow(c.ip) {
			c.emit(protocol.Outbound{Event: "error", RequestID: env.RequestID, Error: "rate limit exceeded"})
			continue
		}
		if err := c.hub.replay.Check(env.Nonce, env.Timestamp); err != nil {
			c.emit(protocol.Outbound{Event: "error", RequestID: env.RequestID, Error: err.Error()})
			continue
		}
		c.handle(env)
	}
}

func (c *Client) writeLoop() {
	for msg := range c.send {
		if err := c.conn.WriteJSON(msg); err != nil {
			return
		}
	}
}

func (c *Client) close() {
	c.hub.mu.Lock()
	if c.userID != "" && c.hub.clients[c.userID] == c {
		delete(c.hub.clients, c.userID)
	}
	c.hub.mu.Unlock()
	close(c.send)
	_ = c.conn.Close()
}

func (c *Client) emit(msg protocol.Outbound) {
	select {
	case c.send <- msg:
	default:
	}
}

func (c *Client) handle(env protocol.Envelope) {
	switch env.Event {
	case "register":
		c.register(env)
	case "message":
		c.directMessage(env)
	case "group:create":
		var d struct {
			GroupID string   `json:"groupId"`
			Members []string `json:"members"`
		}
		if json.Unmarshal(env.Data, &d) == nil {
			c.hub.store.SaveGroup(storage.Group{ID: d.GroupID, Members: d.Members})
		}
	case "group:join":
		var d struct{ GroupID, UserID string }
		_ = json.Unmarshal(env.Data, &d)
		c.hub.store.AddGroupMember(d.GroupID, d.UserID)
	case "group:leave":
		var d struct{ GroupID, UserID string }
		_ = json.Unmarshal(env.Data, &d)
		c.hub.store.RemoveGroupMember(d.GroupID, d.UserID)
	case "group:message":
		c.groupMessage(env)
	case "user:lookup":
		var d struct {
			UserID string `json:"userId"`
		}
		_ = json.Unmarshal(env.Data, &d)
		key, _ := c.hub.store.GetPublicKey(d.UserID)
		c.emit(protocol.Outbound{Event: "user:lookup:result", RequestID: env.RequestID, Data: map[string]any{"publicKey": nullString(key)}})
	case "file:share":
		var d protocol.FileShare
		if json.Unmarshal(env.Data, &d) == nil {
			c.to(d.To, "file:incoming", map[string]any{"from": d.From, "fileId": d.FileID, "fileName": d.FileName, "fileSize": d.FileSize, "mimeType": d.MimeType, "encryptedKey": d.EncryptedKey, "timestamp": protocol.NowMillis()})
		}
	case "webrtc:offer", "webrtc:answer", "webrtc:ice", "p2p:file-offer":
		c.relayByPeer(env)
	default:
		c.emit(protocol.Outbound{Event: "error", RequestID: env.RequestID, Error: "unsupported event"})
	}
}

func (c *Client) register(env protocol.Envelope) {
	d, err := protocol.Unmarshal[protocol.Register](env.Data)
	if err != nil || d.UserID == "" {
		c.emit(protocol.Outbound{Event: "error", RequestID: env.RequestID, Error: "invalid register payload"})
		return
	}
	c.userID = d.UserID
	c.hub.mu.Lock()
	c.hub.clients[d.UserID] = c
	c.hub.mu.Unlock()
	c.hub.store.SetPublicKey(d.UserID, d.PublicKey)
	for _, groupID := range d.Groups {
		c.hub.store.AddGroupMember(groupID, d.UserID)
	}
	c.emit(protocol.Outbound{Event: "registered", RequestID: env.RequestID})
	c.broadcast("user:online", map[string]string{"userId": d.UserID, "publicKey": d.PublicKey})
	for _, msg := range c.hub.store.PopPending(d.UserID) {
		event := "message"
		if msg.GroupID != "" {
			event = "group:message"
		}
		c.emit(protocol.Outbound{Event: event, Data: msg})
	}
}

func (c *Client) directMessage(env protocol.Envelope) {
	d, err := protocol.Unmarshal[protocol.DirectMessage](env.Data)
	if err != nil || d.To == "" {
		return
	}
	if d.ID == "" {
		d.ID = "srv_" + time.Now().Format("20060102150405.000000000")
	}
	payload := storage.PendingMessage{ID: d.ID, From: d.From, To: d.To, Encrypted: d.Encrypted, Timestamp: protocol.NowMillis()}
	if !c.to(d.To, "message", payload) && !d.P2POnly {
		c.hub.store.AddPending(d.To, payload)
	}
}

func (c *Client) groupMessage(env protocol.Envelope) {
	d, err := protocol.Unmarshal[protocol.GroupMessage](env.Data)
	if err != nil {
		return
	}
	group, ok := c.hub.store.GetGroup(d.GroupID)
	if !ok {
		return
	}
	payload := storage.PendingMessage{ID: d.ID, From: d.From, Encrypted: d.Encrypted, Timestamp: protocol.NowMillis(), GroupID: d.GroupID, Content: d.Content}
	for _, member := range group.Members {
		if member == d.From {
			continue
		}
		payload.To = member
		if !c.to(member, "group:message", payload) {
			c.hub.store.AddPending(member, payload)
		}
	}
}

func (c *Client) relayByPeer(env protocol.Envelope) {
	var d map[string]any
	if json.Unmarshal(env.Data, &d) != nil {
		return
	}
	peer, _ := d["peerId"].(string)
	if peer == "" {
		peer, _ = d["to"].(string)
	}
	if c.userID != "" {
		d["from"] = c.userID
	}
	c.to(peer, env.Event, d)
}

func (c *Client) to(userID, event string, data any) bool {
	c.hub.mu.RLock()
	target := c.hub.clients[userID]
	c.hub.mu.RUnlock()
	if target == nil {
		return false
	}
	target.emit(protocol.Outbound{Event: event, Data: data})
	return true
}

func (c *Client) broadcast(event string, data any) {
	c.hub.mu.RLock()
	defer c.hub.mu.RUnlock()
	for userID, target := range c.hub.clients {
		if userID != c.userID {
			target.emit(protocol.Outbound{Event: event, Data: data})
		}
	}
}

func nullString(v string) any {
	if v == "" {
		return nil
	}
	return v
}
