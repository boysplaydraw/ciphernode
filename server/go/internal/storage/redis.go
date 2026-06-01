package storage

import "time"

type Redis struct{}

func NewRedis(_ string, _ Options) (*Redis, error) {
	return nil, ErrRedisNotImplemented
}

var ErrRedisNotImplemented = redisNotImplemented("redis storage adapter is prepared but not implemented")

type redisNotImplemented string

func (e redisNotImplemented) Error() string { return string(e) }

var _ Store = (*redisPlaceholder)(nil)

type redisPlaceholder struct{}

func (*redisPlaceholder) SetPublicKey(string, string)        {}
func (*redisPlaceholder) GetPublicKey(string) (string, bool) { return "", false }
func (*redisPlaceholder) AddPending(string, PendingMessage)  {}
func (*redisPlaceholder) PopPending(string) []PendingMessage { return nil }
func (*redisPlaceholder) SaveGroup(Group)                    {}
func (*redisPlaceholder) GetGroup(string) (Group, bool)      { return Group{}, false }
func (*redisPlaceholder) AddGroupMember(string, string)      {}
func (*redisPlaceholder) RemoveGroupMember(string, string)   {}
func (*redisPlaceholder) SaveFile(SharedFile)                {}
func (*redisPlaceholder) GetFile(string) (SharedFile, bool)  { return SharedFile{}, false }
func (*redisPlaceholder) UpdateFile(SharedFile)              {}
func (*redisPlaceholder) DeleteFile(string)                  {}
func (*redisPlaceholder) Cleanup(time.Time)                  {}
func (*redisPlaceholder) Stats(int) Stats                    { return Stats{} }
