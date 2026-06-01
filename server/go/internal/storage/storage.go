package storage

import "time"

type PendingMessage struct {
	ID        string `json:"id"`
	From      string `json:"from"`
	To        string `json:"to"`
	Encrypted string `json:"encrypted"`
	Timestamp int64  `json:"timestamp"`
	GroupID   string `json:"groupId,omitempty"`
	Content   string `json:"content,omitempty"`
}

type SharedFile struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Size          int64  `json:"size"`
	MimeType      string `json:"mimeType"`
	EncryptedData string `json:"encryptedData"`
	UploadedBy    string `json:"uploadedBy"`
	ExpiresAt     int64  `json:"expiresAt"`
	DownloadCount int    `json:"downloadCount"`
	MaxDownloads  int    `json:"maxDownloads"`
}

type Group struct {
	ID      string   `json:"id"`
	Members []string `json:"members"`
}

type Stats struct {
	ConnectedUsers  int `json:"connectedUsers"`
	PendingMessages int `json:"pendingMessages"`
	PublicKeys      int `json:"publicKeys"`
	Files           int `json:"files"`
}

type Options struct {
	MessageTTL time.Duration
	FileTTL    time.Duration
}

type Store interface {
	SetPublicKey(userID, publicKey string)
	GetPublicKey(userID string) (string, bool)
	AddPending(userID string, msg PendingMessage)
	PopPending(userID string) []PendingMessage
	SaveGroup(group Group)
	GetGroup(groupID string) (Group, bool)
	AddGroupMember(groupID, userID string)
	RemoveGroupMember(groupID, userID string)
	SaveFile(file SharedFile)
	GetFile(fileID string) (SharedFile, bool)
	UpdateFile(file SharedFile)
	DeleteFile(fileID string)
	Cleanup(now time.Time)
	Stats(connected int) Stats
}
