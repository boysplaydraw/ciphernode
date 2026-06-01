package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os/exec"
	"strings"
	"time"
)

// Vulnerability represents a security vulnerability found on a node.
type Vulnerability struct {
	CVE         string `json:"cve"`
	Port        int    `json:"port"`
	Protocol    string `json:"protocol"`
	Severity    string `json:"severity"` // "low", "medium", "high", "critical"
	Description string `json:"description"`
}

// CyberThreat represents an active cyber threat or security risk.
type CyberThreat struct {
	Type        string `json:"type"`        // "botnet", "malware", "open_proxy", "tor_exit", "credential_leak"
	Description string `json:"description"`
	Severity    string `json:"severity"`    // "low", "medium", "high", "critical"
}

// AntiGravitiReport represents the structured report parsed from Anti-Graviti CLI.
type AntiGravitiReport struct {
	Target          string          `json:"target"`
	ScanTime        time.Time       `json:"scan_time"`
	ThreatLevel     string          `json:"threat_level"` // "clean", "low", "medium", "high", "critical"
	Vulnerabilities []Vulnerability `json:"vulnerabilities"`
	CyberThreats    []CyberThreat   `json:"cyber_threats"`
	LeakStatus      bool            `json:"leak_status"`
	IsMocked        bool            `json:"is_mocked,omitempty"`
}

// AntiGravitiScanner manages scanner executions.
type AntiGravitiScanner struct {
	CliBinary string // Path or name of the CLI binary, defaults to "antigraviti"
}

// NewAntiGravitiScanner initializes a new scanner instance.
func NewAntiGravitiScanner(binaryName string) *AntiGravitiScanner {
	if binaryName == "" {
		binaryName = "antigraviti"
	}
	return &AntiGravitiScanner{
		CliBinary: binaryName,
	}
}

// ScanTarget runs the anti-graviti scan on a target IP or domain.
// It respects the given context for timeouts and cancellations.
func (s *AntiGravitiScanner) ScanTarget(ctx context.Context, target string) (*AntiGravitiReport, error) {
	log.Printf("[Scanner] Starting security scan for target: %s", target)

	// Validate target IP/Host format
	trimmedTarget := strings.TrimSpace(target)
	if trimmedTarget == "" {
		return nil, fmt.Errorf("scan target cannot be empty")
	}

	// Check if the CLI binary is available in the path
	_, err := exec.LookPath(s.CliBinary)
	if err != nil {
		log.Printf("[Scanner] WARNING: %s CLI binary not found in PATH. Falling back to Mock Scanner Mode for demonstration.", s.CliBinary)
		return s.generateMockReport(trimmedTarget), nil
	}

	// Prepare command: antigraviti scan --target <IP> --format json
	// We run it with context to ensure it respects timeout limits (e.g. if scan hangs)
	cmd := exec.CommandContext(ctx, s.CliBinary, "scan", "--target", trimmedTarget, "--format", "json")
	
	outputBytes, err := cmd.Output()
	if err != nil {
		// Check if the error is due to a timeout/cancellation
		if ctx.Err() != nil {
			return nil, fmt.Errorf("scan execution timed out or was cancelled: %w", ctx.Err())
		}
		
		// If command failed but returned error output, log it
		if exitErr, ok := err.(*exec.ExitError); ok {
			log.Printf("[Scanner] CLI exited with error code: %s", string(exitErr.Stderr))
			return nil, fmt.Errorf("cli scan error (exit code %d): %s", exitErr.ExitCode(), string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("failed to execute scan CLI: %w", err)
	}

	// Parse JSON output into our structured report
	var report AntiGravitiReport
	if err := json.Unmarshal(outputBytes, &report); err != nil {
		return nil, fmt.Errorf("failed to parse scan JSON output: %w. Raw output: %s", err, string(outputBytes))
	}

	log.Printf("[Scanner] Completed scan for %s. Threat Level: %s", target, report.ThreatLevel)
	return &report, nil
}

// generateMockReport generates high-quality security reports for sandbox/testing purposes.
// It will flag specific mock IPs (e.g., 66.66.66.66 or 192.168.1.66) as CRITICAL threats
// to allow the P2P connection dropping and blacklisting mechanism to be easily tested.
func (s *AntiGravitiScanner) generateMockReport(target string) *AntiGravitiReport {
	// Simulate scanning latency
	time.Sleep(800 * time.Millisecond)

	report := &AntiGravitiReport{
		Target:      target,
		ScanTime:    time.Now(),
		ThreatLevel: "clean",
		IsMocked:    true,
	}

	// If target IP represents a malicious node (contains .66 or is common test IPs)
	isMalicious := strings.Contains(target, ".66") || strings.Contains(target, "66.66") || target == "192.168.1.13"

	if isMalicious {
		report.ThreatLevel = "critical"
		report.LeakStatus = true
		report.Vulnerabilities = []Vulnerability{
			{
				CVE:         "CVE-2024-3094",
				Port:        22,
				Protocol:    "TCP",
				Severity:    "critical",
				Description: "Backdoor discovered in upstream XZ Utils (liblzma) leading to remote code execution.",
			},
			{
				CVE:         "CVE-2023-38606",
				Port:        8080,
				Protocol:    "TCP",
				Severity:    "high",
				Description: "Remote command injection vulnerability in auxiliary web portal module.",
			},
		}
		report.CyberThreats = []CyberThreat{
			{
				Type:        "botnet",
				Description: "IP is identified as an active command & control (C2) node of the Mirai-derivative malware family.",
				Severity:    "critical",
			},
			{
				Type:        "credential_leak",
				Description: "Confidential credentials associated with this node ID were leaked on underground intelligence feeds.",
				Severity:    "high",
			},
		}
		log.Printf("[Scanner] [MOCK] Generated CRITICAL threat report for target %s (Testing blacklist response)", target)
	} else {
		// Clean / Normal Node
		// We can add a low-level vulnerability just for realism
		isLowRisk := net.ParseIP(target) != nil && int(net.ParseIP(target)[15])%2 == 0
		if isLowRisk {
			report.ThreatLevel = "low"
			report.Vulnerabilities = []Vulnerability{
				{
					CVE:         "CVE-2022-2274",
					Port:        443,
					Protocol:    "TCP",
					Severity:    "low",
					Description: "Out-of-bounds read in OpenSSL v3.0.4 when executing RSA decryption.",
				},
			}
			log.Printf("[Scanner] [MOCK] Generated LOW threat report for target %s", target)
		} else {
			log.Printf("[Scanner] [MOCK] Generated CLEAN security report for target %s", target)
		}
	}

	return report
}
