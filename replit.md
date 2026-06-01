# CipherNode

## Overview

CipherNode is a privacy-first, open-source P2P/E2EE messenger that requires no account creation. Users are identified solely by locally-generated PGP cryptographic keys. The app supports end-to-end encrypted messaging, group chats, disappearing messages, QR code contact exchange, and self-hosted relay servers via Docker.

The project is a full-stack application with a React Native/Expo frontend (supporting iOS, Android, and Web) and an Express.js backend that acts as a message relay server using WebSocket/Socket.io.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React Native with Expo SDK 54, supporting iOS, Android, and Web platforms
- **Navigation**: React Navigation with a 3-tab structure (Chats, Add Contact, Settings) plus stack navigators for each section
- **State Management**: React Query for server state, local React state with hooks for UI state
- **Styling**: Custom theme system with cyberpunk dark aesthetic (cyan #00F5FF and purple #B877FF accents)
- **Local Storage**: AsyncStorage for contacts, messages, settings, and cryptographic keys

### Backend Architecture
- **Server**: Express.js with Node.js
- **Real-time**: Socket.io for WebSocket-based message relay
- **Message Storage**: In-memory storage with 24-hour TTL for pending messages (no persistent database currently used for messages)
- **API Design**: RESTful endpoints for health checks and stats, WebSocket for real-time messaging

### Authentication & Identity
- **No Traditional Auth**: Users are identified by locally-generated PGP key pairs
- **Identity Format**: 8-character ID derived from PGP fingerprint (XXXX-XXXX format)
- **Key Generation**: RSA 2048-bit keys generated via openpgp.js
- **Contact Exchange**: QR codes or manual ID entry

### Encryption
- **Library**: openpgp.js for PGP/GPG-compatible encryption
- **Message Encryption**: AES-256 + RSA end-to-end encryption with digital signatures
- **Key Storage**: Private keys stored locally in AsyncStorage, never transmitted
- **Signature Verification**: Messages are signed on send and verified on receive; unverified messages show warning icon
- **Storage Security**: 
  - Sent messages store plaintext (for sender display) and encrypted payload
  - Received messages store encrypted payload only, decrypted at render time
  - Message objects are cloned before UI consumption to prevent mutations leaking to storage

### Database Schema
- Drizzle ORM configured for PostgreSQL (schema exists but not actively used for core messaging)
- Schema includes a basic users table with id, username, and password fields
- Current message relay uses in-memory storage; PostgreSQL may be added for persistent features

### Project Structure
```
client/          # React Native/Expo frontend
  ├── screens/   # App screens (Chats, Settings, etc.)
  ├── components/# Reusable UI components
  ├── lib/       # Utilities (crypto, storage, socket)
  ├── hooks/     # Custom React hooks
  ├── navigation/# React Navigation setup
  └── constants/ # Theme configuration

server/          # Express backend
  ├── index.ts   # Server entry point
  ├── routes.ts  # API endpoints and Socket.io setup
  └── storage.ts # In-memory storage implementation

shared/          # Shared code between client/server
  └── schema.ts  # Drizzle database schema
```

## External Dependencies

### Third-Party Libraries
- **openpgp.js**: PGP encryption/decryption for E2EE messaging
- **socket.io**: Real-time bidirectional WebSocket communication
- **expo-camera**: QR code scanning for contact exchange
- **expo-local-authentication**: Biometric lock support
- **react-native-qrcode-svg**: QR code generation for identity sharing
- **drizzle-orm**: Database ORM (PostgreSQL dialect configured)

### Database
- **PostgreSQL**: Configured via Drizzle ORM but not actively used for core messaging
- **In-Memory Storage**: Current message relay uses Map-based storage with TTL

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (required for Drizzle)
- `EXPO_PUBLIC_DOMAIN`: API server domain for client connections
- `REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS`: Replit-specific CORS configuration

### Docker Support
- Self-hosted relay server deployment via Docker Compose
- Minimum requirements: 256MB RAM, 1 CPU core