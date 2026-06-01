# CipherNode Go Relay

This is the migration target for the Node.js Socket.IO relay. It exposes:

- `GET /health` and `GET /api/health`
- `GET /api/stats`
- `GET /api/users/:userId/publickey`
- `POST /api/files/upload`
- `GET /api/files/:fileId`
- `GET /api/files/:fileId/info`
- `GET /ws` raw WebSocket relay

WebSocket messages use a JSON envelope:

```json
{
  "event": "message",
  "requestId": "optional-client-request-id",
  "nonce": "optional-unique-nonce",
  "timestamp": 1760000000000,
  "data": {}
}
```

The server is a relay only. It stores encrypted payloads and file metadata but does not decrypt E2EE content.
