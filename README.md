# CipherNode

**A privacy-first, open-source P2P/E2EE messenger with no account requirement.**

![License](https://img.shields.io/badge/license-GPLv3-blue)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20Web-green)
![Status](https://img.shields.io/badge/status-Active%20Development-yellow)

## Overview

CipherNode is an open-source messenger that prioritizes privacy and security. It enables encrypted communication between users without requiring account creation, email verification, or personal information. All messages are encrypted end-to-end using industry-standard cryptography (AES-256 + RSA via OpenPGP).

### Key Features

- **No Account Required**: Identity is based on locally-generated PGP keys only
- **End-to-End Encryption**: AES-256 + RSA encryption via openpgp.js
- **Group Chat**: Create secure groups with multiple participants
- **Disappearing Messages**: Auto-delete messages after a set time
- **QR Code Exchange**: Share contacts securely via QR codes
- **Message Archive**: Archive conversations without deleting them
- **Privacy Modules**: Toggleable security features (Screen Protection, Biometric Lock, Metadata Scrubbing, Steganography, Ghost Mode, P2P Only, Low Power Mode)
- **Custom Server Support**: Point to your own relay server
- **Docker Deployment**: Self-host with provided Docker configuration
- **Turkish UI**: Full Turkish language support
- **Cyberpunk Design**: Dark theme with cyan and purple aesthetic optimized for Samsung S22 Ultra

## Architecture

### Tech Stack

- **Frontend**: React Native + Expo (iOS, Android, Web)
- **Backend**: Express.js + Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **Encryption**: openpgp.js (GPG/PGP compatible)
- **Real-time Communication**: WebSocket + Socket.io (relay), WebRTC (P2P planned)
- **Storage**: AsyncStorage (mobile), IndexedDB (web)

### Project Structure

```
.
├── client/                 # React Native/Expo frontend
│   ├── screens/           # App screens
│   ├── components/        # Reusable UI components
│   ├── lib/               # Utilities (crypto, storage, API)
│   ├── hooks/             # Custom React hooks
│   ├── constants/         # Theme and configuration
│   └── navigation/        # React Navigation setup
├── server/                # Express backend
│   ├── routes/            # API endpoints
│   ├── middleware/        # Express middleware
│   ├── db/                # Database schema (Drizzle)
│   └── index.ts           # Server entry point
├── docker-compose.yml     # Docker orchestration
├── DOCKER.md              # Docker deployment guide
└── package.json           # Dependencies
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (for mobile development)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/ciphernode.git
   cd ciphernode
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Create .env.local
   EXPO_PUBLIC_DOMAIN=localhost:5000
   SESSION_SECRET=your-secret-key
   ```

4. **Start the development server**
   ```bash
   npm run server:dev    # Terminal 1: Start Express backend on port 5000
   npm run expo:dev      # Terminal 2: Start Expo dev server on port 8081
   ```

5. **Access the app**
   - **Web**: http://localhost:8081
   - **Mobile**: Scan QR code with Expo Go app

## Deployment

### Building Android APK

Build a native Android APK using EAS Build:

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Login to Expo account
eas login

# Build preview APK (for testing)
npm run build:apk:preview

# Build production APK (for distribution)
npm run build:apk:production
```

The project includes native crypto support via `react-native-quick-crypto` for Web Crypto API compatibility, ensuring OpenPGP encryption works correctly in native builds.

For detailed build instructions and troubleshooting, see [BUILD_APK.md](BUILD_APK.md).

### Self-Hosted with Docker

CipherNode includes comprehensive Docker configuration for self-hosting:

```bash
docker-compose up -d
```

For detailed deployment instructions, see [DOCKER.md](DOCKER.md).

### Features

- **Persistent PostgreSQL database** with automatic initialization
- **Nginx reverse proxy** for TLS/SSL termination
- **Environment-based configuration**
- **Health checks** for all services
- **Volume management** for data persistence

## Privacy & Security

### User Identification

Users are identified by the SHA-256 hash of their PGP public key (format: `XXXX-XXXX`). This means:
- No personal information is stored
- No account registration
- No phone number or email required
- Identity is purely cryptographic

### Message Encryption

1. Messages are encrypted client-side with the recipient's public key (RSA)
2. The encrypted payload is then encrypted with AES-256 for additional security
3. Server stores only encrypted messages
4. Server cannot decrypt or read messages
5. Decryption happens only on the recipient's device

### Privacy Toggles

- **Screen Protection**: Prevent screenshots and screen recording
- **Biometric Lock**: Require fingerprint/face to unlock app
- **Auto-Metadata Scrubbing**: Remove EXIF data from images
- **Steganography Mode**: Hide messages within images
- **Ghost Mode**: Hide typing indicators and read receipts
- **P2P Only Mode**: Bypass relay server (WebRTC required)
- **Low Power Mode**: Reduce animations and UI effects

## Usage

### Creating an Identity

1. Open the app
2. Complete onboarding (automatically generates PGP keypair)
3. Set optional display name
4. Your ID will be displayed as XXXX-XXXX

### Starting a Chat

1. **Add Contact**: Use QR code exchange or manual ID entry
2. **Send Message**: Type and send encrypted messages
3. **Set Timer**: Messages auto-delete after selected duration
4. **Archive**: Archive conversations without deleting

### Group Chat

1. Create new group with name and description
2. Add members via QR or manual ID
3. All messages encrypted for the group
4. Admin can manage members

## API Reference

### Core Endpoints

#### Authentication (Identity)
- `POST /api/identity` - Generate/load identity
- `GET /api/identity/:id` - Get public key by ID

#### Messages
- `POST /api/messages` - Send encrypted message
- `GET /api/messages/:recipientId` - Retrieve messages
- `DELETE /api/messages/:id` - Delete message

#### Groups
- `POST /api/groups` - Create group
- `GET /api/groups` - List groups
- `POST /api/groups/:id/members` - Add member
- `DELETE /api/groups/:id/members/:memberId` - Remove member

#### WebSocket Events (Socket.io)
- `message:send` - Real-time message delivery
- `typing:start` - Typing indicator
- `typing:stop` - Stop typing

## Configuration

### Environment Variables

```env
# Server
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://user:pass@localhost/ciphernode

# Client
EXPO_PUBLIC_DOMAIN=yourdomain.com:5000
```

### Custom Server

To use a custom relay server:
1. Open Settings in app
2. Go to Network Settings
3. Enter custom server URL
4. All traffic routes through specified server

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Use TypeScript for type safety
- Follow existing code patterns
- Format with Prettier (`npm run format`)
- Lint with ESLint (`npm run lint`)

## Security Considerations

### Known Limitations

- **WebRTC P2P**: Deferred to future phases (currently uses relay server only)
- **Key Management**: Private keys stored locally; user responsible for backup
- **Perfect Forward Secrecy**: Not yet implemented
- **Metadata**: Relay server can see connection patterns (use Tor/VPN for anonymity)

### Reporting Security Issues

Do NOT open public issues for security vulnerabilities. Email security concerns to: [your-email@example.com]

## Roadmap

- [ ] WebRTC P2P connectivity
- [ ] Perfect Forward Secrecy (PFS)
- [ ] Message reactions and replies
- [ ] Voice/Video calling
- [ ] Desktop apps (Electron)
- [ ] Proxy/Tor support
- [ ] Group video calls
- [ ] File sharing optimization

## License

This project is licensed under the **GNU General Public License v3.0** - see [LICENSE](LICENSE) for details.

**Important**: Any modifications or derivatives must be open-source and distributed under the same GPLv3 license.

## Acknowledgments

- [openpgp.js](https://openpgpjs.org/) - OpenPGP encryption library
- [Expo](https://expo.dev/) - React Native framework
- [React Navigation](https://reactnavigation.org/) - Navigation library
- [Drizzle ORM](https://orm.drizzle.team/) - Database ORM

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/ciphernode/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/ciphernode/discussions)
- **Documentation**: See [DOCKER.md](DOCKER.md) for deployment

## Disclaimer

**BETA SOFTWARE**: CipherNode is under active development. While security has been a priority, no software is 100% secure. Use at your own risk and conduct your own security audit before deploying to production.

The developers assume no liability for:
- Data loss
- Message interception
- Cryptographic failures
- Configuration errors
- Third-party vulnerabilities

---

**Made with ❤️ for privacy-conscious users**

Last Updated: December 26, 2025
