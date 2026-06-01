package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestAntiGravitiScanner checks mock output generation and security triggers.
func TestAntiGravitiScanner(t *testing.T) {
	scanner := NewAntiGravitiScanner("antigraviti")
	ctx := context.Background()

	t.Run("Clean Target Scan", func(t *testing.T) {
		report, err := scanner.ScanTarget(ctx, "192.168.1.10")
		if err != nil {
			t.Fatalf("ScanTarget failed: %v", err)
		}
		if report.ThreatLevel != "clean" && report.ThreatLevel != "low" {
			t.Errorf("Expected low or clean threat level, got: %s", report.ThreatLevel)
		}
	})

	t.Run("Critical Threat Target Scan", func(t *testing.T) {
		// IPs containing 66 should trigger the mock scanner's critical vulnerability report
		report, err := scanner.ScanTarget(ctx, "66.66.66.66")
		if err != nil {
			t.Fatalf("ScanTarget failed: %v", err)
		}
		if report.ThreatLevel != "critical" {
			t.Errorf("Expected critical threat level for mock malicious IP, got: %s", report.ThreatLevel)
		}
		if len(report.Vulnerabilities) == 0 {
			t.Errorf("Expected vulnerabilities in critical threat report")
		}
		if len(report.CyberThreats) == 0 {
			t.Errorf("Expected cyber threats in critical threat report")
		}
	})

	t.Run("Timeout Handling", func(t *testing.T) {
		// Context that expires instantly
		timeoutCtx, cancel := context.WithTimeout(context.Background(), 1*time.Microsecond)
		defer cancel()

		_, err := scanner.ScanTarget(timeoutCtx, "192.168.1.10")
		// The mock scanner has an intentional Sleep, so it should trigger context deadline exceed
		if err == nil {
			t.Error("Expected context deadline error, got nil")
		}
	})
}

// TestSecurityManager checks blacklist behavior and disconnect callbacks.
func TestSecurityManager(t *testing.T) {
	sm := NewSecurityManager()

	t.Run("Blacklist IP", func(t *testing.T) {
		ip := "192.168.1.99"
		sm.BlacklistIP(ip, "Test block")

		isBlocked, reason := sm.IsIPBlacklisted(ip)
		if !isBlocked {
			t.Error("Expected IP to be blacklisted")
		}
		if reason != "Test block" {
			t.Errorf("Expected reason 'Test block', got '%s'", reason)
		}

		sm.RemoveIPFromBlacklist(ip)
		isBlocked, _ = sm.IsIPBlacklisted(ip)
		if isBlocked {
			t.Error("Expected IP to be unblocked")
		}
	})

	t.Run("Blacklist Node ID", func(t *testing.T) {
		nodeID := "node-abc-123"
		sm.BlacklistNode(nodeID, "Vulnerability status high")

		isBlocked, reason := sm.IsNodeBlacklisted(nodeID)
		if !isBlocked {
			t.Error("Expected Node ID to be blacklisted")
		}
		if reason != "Vulnerability status high" {
			t.Errorf("Expected reason, got '%s'", reason)
		}

		sm.RemoveNodeFromBlacklist(nodeID)
		isBlocked, _ = sm.IsNodeBlacklisted(nodeID)
		if isBlocked {
			t.Error("Expected Node ID to be unblocked")
		}
	})

	t.Run("Disconnect Event Trigger", func(t *testing.T) {
		callbackFired := false
		firedNodeID := ""
		firedIP := ""

		sm.RegisterDisconnectCallback(func(nodeID string, ip string) {
			callbackFired = true
			firedNodeID = nodeID
			firedIP = ip
		})

		sm.BlacklistIP("10.0.0.50", "Testing trigger")
		
		// Yield to allow background callback goroutine to execute
		time.Sleep(10 * time.Millisecond)

		if !callbackFired {
			t.Error("Expected security disconnect callback to fire")
		}
		if firedIP != "10.0.0.50" {
			t.Errorf("Expected callback IP 10.0.0.50, got %s", firedIP)
		}

		callbackFired = false
		sm.BlacklistNode("user-test-id", "Testing node trigger")
		time.Sleep(10 * time.Millisecond)

		if !callbackFired {
			t.Error("Expected security disconnect callback to fire on node ID")
		}
		if firedNodeID != "user-test-id" {
			t.Errorf("Expected callback Node ID user-test-id, got %s", firedNodeID)
		}
	})
}

// TestAsynchronousThreatScanIntegration verifies that a connected client on a malicious IP
// gets automatically blacklisted and disconnected by the server background loop.
func TestAsynchronousThreatScanIntegration(t *testing.T) {
	// Initialize scanner & security manager
	scanner = NewAntiGravitiScanner("antigraviti")
	securityManager = NewSecurityManager()

	callbackFired := false
	securityManager.RegisterDisconnectCallback(func(nodeID string, ip string) {
		callbackFired = true
	})

	// Setup a mock WebSocket Server to connect a client
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		
		// Bind to malicious IP format (simulating connection from 66.66.66.66)
		clientConn := &ClientConn{
			Conn:     conn,
			IP:       "66.66.66.66",
			SocketID: "mock-socket-id",
			UserID:   "malicious-node-id",
		}
		
		// Run scanning routine
		runAsynchronousThreatScan(clientConn)
	}))
	defer s.Close()

	// Connect a dummy client
	url := "ws" + strings.TrimPrefix(s.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("Failed to dial test websocket: %v", err)
	}
	defer conn.Close()

	// Wait for the background threat scanner to complete (has an 800ms mock sleep)
	time.Sleep(1500 * time.Millisecond)

	// Verify that the IP was blacklisted
	isBlocked, _ := securityManager.IsIPBlacklisted("66.66.66.66")
	if !isBlocked {
		t.Error("Expected client IP 66.66.66.66 to be blacklisted after critical vulnerability scan detection")
	}

	// Verify that the Node ID was blacklisted
	isNodeBlocked, _ := securityManager.IsNodeBlacklisted("malicious-node-id")
	if !isNodeBlocked {
		t.Error("Expected Node ID malicious-node-id to be blacklisted after scan")
	}

	if !callbackFired {
		t.Error("Expected drop/disconnect callback to fire for malicious client connection")
	}
}
