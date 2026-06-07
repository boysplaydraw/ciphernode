package storage

import (
	"sync"
	"time"
)

type Memory struct {
	mu              sync.RWMutex
	publicKey       map[string]string
	pending         map[string][]PendingMessage
	contacts        map[string][]byte
	pendingContacts map[string][]PendingContact
	groups          map[string]Group
	files           map[string]SharedFile
	opts            Options
}

func NewMemory(opts Options) *Memory {
	return &Memory{
		publicKey:       map[string]string{},
		pending:         map[string][]PendingMessage{},
		contacts:        map[string][]byte{},
		pendingContacts: map[string][]PendingContact{},
		groups:          map[string]Group{},
		files:           map[string]SharedFile{},
		opts:            opts,
	}
}

func (m *Memory) SetPublicKey(userID, publicKey string) {
	if userID == "" || publicKey == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.publicKey[userID] = publicKey
}

func (m *Memory) GetPublicKey(userID string) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.publicKey[userID]
	return v, ok
}

func (m *Memory) AddPending(userID string, msg PendingMessage) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pending[userID] = append(m.pending[userID], msg)
}

func (m *Memory) PopPending(userID string) []PendingMessage {
	m.mu.Lock()
	defer m.mu.Unlock()
	msgs := append([]PendingMessage(nil), m.pending[userID]...)
	delete(m.pending, userID)
	return msgs
}

func (m *Memory) SaveContacts(userID string, contacts []byte) {
	if userID == "" || len(contacts) == 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.contacts[userID] = append([]byte(nil), contacts...)
}

func (m *Memory) GetContacts(userID string) ([]byte, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.contacts[userID]
	return v, ok
}

func (m *Memory) AddPendingContact(userID string, contact PendingContact) {
	if userID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	// Aynı göndericiden tekrarlı bekleyen bildirimleri birleştir
	for i, existing := range m.pendingContacts[userID] {
		if existing.From == contact.From {
			m.pendingContacts[userID][i] = contact
			return
		}
	}
	m.pendingContacts[userID] = append(m.pendingContacts[userID], contact)
}

func (m *Memory) PopPendingContacts(userID string) []PendingContact {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := append([]PendingContact(nil), m.pendingContacts[userID]...)
	delete(m.pendingContacts, userID)
	return out
}

func (m *Memory) SaveGroup(group Group) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.groups[group.ID] = group
}

func (m *Memory) GetGroup(groupID string) (Group, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	g, ok := m.groups[groupID]
	return g, ok
}

func (m *Memory) AddGroupMember(groupID, userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	g := m.groups[groupID]
	g.ID = groupID
	for _, member := range g.Members {
		if member == userID {
			m.groups[groupID] = g
			return
		}
	}
	g.Members = append(g.Members, userID)
	m.groups[groupID] = g
}

func (m *Memory) RemoveGroupMember(groupID, userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.groups[groupID]
	if !ok {
		return
	}
	out := g.Members[:0]
	for _, member := range g.Members {
		if member != userID {
			out = append(out, member)
		}
	}
	if len(out) == 0 {
		delete(m.groups, groupID)
		return
	}
	g.Members = out
	m.groups[groupID] = g
}

func (m *Memory) SaveFile(file SharedFile) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files[file.ID] = file
}

func (m *Memory) GetFile(fileID string) (SharedFile, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	f, ok := m.files[fileID]
	return f, ok
}

func (m *Memory) UpdateFile(file SharedFile) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files[file.ID] = file
}

func (m *Memory) DeleteFile(fileID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.files, fileID)
}

func (m *Memory) Cleanup(now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	nowMs := now.UnixMilli()
	for userID, msgs := range m.pending {
		kept := msgs[:0]
		for _, msg := range msgs {
			if time.Duration(nowMs-msg.Timestamp)*time.Millisecond < m.opts.MessageTTL {
				kept = append(kept, msg)
			}
		}
		if len(kept) == 0 {
			delete(m.pending, userID)
		} else {
			m.pending[userID] = kept
		}
	}
	for userID, contacts := range m.pendingContacts {
		kept := contacts[:0]
		for _, ct := range contacts {
			if time.Duration(nowMs-ct.Timestamp)*time.Millisecond < m.opts.MessageTTL {
				kept = append(kept, ct)
			}
		}
		if len(kept) == 0 {
			delete(m.pendingContacts, userID)
		} else {
			m.pendingContacts[userID] = kept
		}
	}
	for id, file := range m.files {
		if nowMs > file.ExpiresAt || file.DownloadCount >= file.MaxDownloads {
			delete(m.files, id)
		}
	}
}

func (m *Memory) Stats(connected int) Stats {
	m.mu.RLock()
	defer m.mu.RUnlock()
	pending := 0
	for _, msgs := range m.pending {
		pending += len(msgs)
	}
	return Stats{ConnectedUsers: connected, PendingMessages: pending, PublicKeys: len(m.publicKey), Files: len(m.files)}
}
