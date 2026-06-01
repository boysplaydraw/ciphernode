package main

import (
	"log"
	"net"
	"sync"
	"time"
)

// BlacklistEntry holds details about why a node was blacklisted.
type BlacklistEntry struct {
	BlockedAt time.Time
	Reason    string
	Target    string // IP or Node ID
}

// SecurityManager coordinates connection blocking and threat records.
type SecurityManager struct {
	mu           sync.RWMutex
	blacklistedIPs   map[string]BlacklistEntry
	blacklistedNodes map[string]BlacklistEntry
	disconnectCallbacks []func(nodeID string, ip string)
}

// NewSecurityManager initializes the security coordinator.
func NewSecurityManager() *SecurityManager {
	return &SecurityManager{
		blacklistedIPs:   make(map[string]BlacklistEntry),
		blacklistedNodes: make(map[string]BlacklistEntry),
	}
}

// RegisterDisconnectCallback allows the Socket/WebSocket server to register a handler
// that instantly terminates matching connections when a security blacklist is triggered.
func (sm *SecurityManager) RegisterDisconnectCallback(callback func(nodeID string, ip string)) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.disconnectCallbacks = append(sm.disconnectCallbacks, callback)
}

// BlacklistIP blocks all incoming traffic from an IP address.
func (sm *SecurityManager) BlacklistIP(ip string, reason string) {
	sm.mu.Lock()
	// Parse IP to standard format
	parsedIP := net.ParseIP(ip)
	var key string
	if parsedIP != nil {
		key = parsedIP.String()
	} else {
		key = ip // Fallback
	}

	sm.blacklistedIPs[key] = BlacklistEntry{
		BlockedAt: time.Now(),
		Reason:    reason,
		Target:    key,
	}
	log.Printf("[Security] IP BLACKLISTED: %s. Reason: %s", key, reason)
	sm.mu.Unlock()

	// Trigger disconnect for all sockets matching this IP
	sm.triggerDisconnect("", key)
}

// BlacklistNode blocks a specific cryptographic Node ID (userId) from registering/messaging.
func (sm *SecurityManager) BlacklistNode(nodeID string, reason string) {
	sm.mu.Lock()
	sm.blacklistedNodes[nodeID] = BlacklistEntry{
		BlockedAt: time.Now(),
		Reason:    reason,
		Target:    nodeID,
	}
	log.Printf("[Security] NODE ID BLACKLISTED: %s. Reason: %s", nodeID, reason)
	sm.mu.Unlock()

	// Trigger disconnect for all sockets matching this NodeID
	sm.triggerDisconnect(nodeID, "")
}

// IsIPBlacklisted checks if an IP is blacklisted. Returns (isBlocked, reason).
func (sm *SecurityManager) IsIPBlacklisted(ip string) (bool, string) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	// Handle standard IP lookup
	parsedIP := net.ParseIP(ip)
	var key string
	if parsedIP != nil {
		key = parsedIP.String()
	} else {
		key = ip
	}

	entry, ok := sm.blacklistedIPs[key]
	if ok {
		return true, entry.Reason
	}
	return false, ""
}

// IsNodeBlacklisted checks if a cryptographic Node ID is blacklisted.
func (sm *SecurityManager) IsNodeBlacklisted(nodeID string) (bool, string) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	entry, ok := sm.blacklistedNodes[nodeID]
	if ok {
		return true, entry.Reason
	}
	return false, ""
}

// RemoveIPFromBlacklist unblocks an IP.
func (sm *SecurityManager) RemoveIPFromBlacklist(ip string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	parsedIP := net.ParseIP(ip)
	var key string
	if parsedIP != nil {
		key = parsedIP.String()
	} else {
		key = ip
	}

	delete(sm.blacklistedIPs, key)
	log.Printf("[Security] IP UNBLOCKED: %s", key)
}

// RemoveNodeFromBlacklist unblocks a Node ID.
func (sm *SecurityManager) RemoveNodeFromBlacklist(nodeID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	delete(sm.blacklistedNodes, nodeID)
	log.Printf("[Security] NODE ID UNBLOCKED: %s", nodeID)
}

// GetStats returns the number of blocked nodes and IPs.
func (sm *SecurityManager) GetStats() (int, int) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.blacklistedIPs), len(sm.blacklistedNodes)
}

// triggerDisconnect fires registered connection termination routines.
func (sm *SecurityManager) triggerDisconnect(nodeID string, ip string) {
	sm.mu.RLock()
	callbacks := sm.disconnectCallbacks
	sm.mu.RUnlock()

	for _, cb := range callbacks {
		// Run in a separate goroutine to avoid holding security locks or blocking execution flow
		go cb(nodeID, ip)
	}
}
