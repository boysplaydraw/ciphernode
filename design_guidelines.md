# CipherNode - Design Guidelines

## Architecture Decisions

### Authentication
**No Authentication Required** - The app uses locally-generated cryptographic IDs instead of traditional accounts.

**Profile/Settings Implementation:**
- **User Identity Screen:**
  - Display user's generated ID prominently (format: XXXX-XXXX)
  - Show PGP public key fingerprint
  - Exportable identity (QR code + backup file)
  - Customizable display name (local only, shared during handshake)
  - No avatar system (aligns with privacy-first ethos)

- **Settings Structure:**
  - Privacy: Disappearing message timer defaults, read receipts toggle
  - Network: Server selection (Official/Custom URL input)
  - Security: Key regeneration (with data loss warning), encryption status
  - Advanced: Relay preference (P2P-only mode toggle), connection diagnostics

### Navigation Architecture
**Tab Navigation (3 tabs):**
1. **Chats** (Home) - Left tab
2. **Add Contact** (Core Action) - Center tab with distinctive icon
3. **Settings** - Right tab

**Stack Structure:**
- Chats Stack: Chats List → Chat Thread → Contact Info
- Add Contact Stack: Add Contact (QR/ID entry)
- Settings Stack: Settings → Network Config → Security Settings → About/Licenses

**Modal Screens:**
- QR Scanner (full screen camera)
- Message Info (encryption status, delivery status)
- Key Export/Import flows

---

## Screen Specifications

### 1. Chats List (Home)
**Purpose:** View all active conversations, monitor connection status.

**Layout:**
- **Header:** Transparent with app title "CipherNode"
  - Left: Connection status indicator (dot: green=P2P, yellow=Relay, red=Offline)
  - Right: None
  - No search bar (minimal contact list expected)
- **Content:** FlatList (scrollable)
  - Empty state: Illustration with "No chats yet" + quick action to Add Contact tab
  - Chat items show: Contact name/ID, last message preview (truncated), timestamp, unread badge, encryption status icon
- **Safe Area:** Top: headerHeight + Spacing.xl, Bottom: tabBarHeight + Spacing.xl

### 2. Chat Thread
**Purpose:** Send/receive E2EE messages in a conversation.

**Layout:**
- **Header:** Default navigation with custom title
  - Title: Contact name (or ID if unnamed)
  - Subtitle: Connection status ("P2P" / "Via Relay" / "Connecting...")
  - Right: Info button (opens Contact Info)
- **Content:** Inverted FlatList (messages scroll bottom-to-top)
  - Message bubbles: Sent (right-aligned), Received (left-aligned)
  - Each message shows: Text content, timestamp, encryption icon, self-destruct timer (if active)
- **Floating Elements:** 
  - Message input bar (bottom, above tab bar) with: Text input + Send button
  - Safe area: bottom: tabBarHeight + Spacing.xl
- **Safe Area:** Content: Top: Spacing.xl, Bottom: input bar height + tabBarHeight + Spacing.xl

### 3. Add Contact
**Purpose:** Add new contacts via QR code scan or manual ID entry.

**Layout:**
- **Header:** Transparent with title "Add Contact"
- **Content:** Scrollable view (not a form)
  - Large "Scan QR Code" button (opens modal camera scanner)
  - Divider with "OR"
  - "Enter Contact ID" section with:
    - TextInput (format: XXXX-XXXX validation)
    - "Add" button below input
  - "Share Your ID" section showing:
    - User's ID (copyable)
    - QR code display of user's public key
- **Safe Area:** Top: headerHeight + Spacing.xl, Bottom: tabBarHeight + Spacing.xl

### 4. Contact Info
**Purpose:** View contact details, manage conversation settings.

**Layout:**
- **Header:** Default navigation with "Contact Info" title
  - Right: None
- **Content:** ScrollView with sections:
  - Contact ID (copyable)
  - Public key fingerprint (truncated, expandable)
  - Disappearing messages toggle + timer selector
  - Encryption status (always "E2EE Active" with technical details)
  - Destructive: "Delete Conversation" button (red, with confirmation)
- **Safe Area:** Top: Spacing.xl, Bottom: tabBarHeight + Spacing.xl

### 5. Settings
**Purpose:** Configure app preferences, server, and security.

**Layout:**
- **Header:** Transparent with title "Settings"
- **Content:** Grouped list (SectionList)
  - Identity section: Display name input
  - Privacy section: Default message timer
  - Network section: Server selection (Official/Custom), connection stats
  - Security section: "Regenerate Keys" (warning modal), "Export Identity"
  - About section: Version, licenses (opens GPL text), GitHub link
- **Safe Area:** Top: headerHeight + Spacing.xl, Bottom: tabBarHeight + Spacing.xl

---

## Design System

### Color Palette (Cyberpunk/Minimalist Dark)
**Primary Colors:**
- Background: `#0A0E14` (deep black-blue)
- Surface: `#151B26` (elevated surface)
- Surface Variant: `#1E2433` (cards, inputs)

**Accent Colors:**
- Primary: `#00F5FF` (cyan - connection indicators, active states)
- Secondary: `#B877FF` (purple - encryption indicators)
- Success: `#00FF88` (green - P2P connection)
- Warning: `#FFB800` (amber - relay connection)
- Error: `#FF4757` (red - offline, destructive actions)

**Text:**
- Primary: `#E5E9F0` (high contrast)
- Secondary: `#8892A6` (muted)
- Disabled: `#434C5E`

**Borders/Dividers:** `#2E3440` (subtle separation)

### Typography
- **Headings:** SF Pro Display (iOS) / Roboto (Android), Bold, 20-24px
- **Body:** SF Pro Text / Roboto, Regular, 16px
- **Captions:** 12-14px, Medium weight
- **Monospace (IDs/Keys):** SF Mono / Roboto Mono, 14px

### Components

**Message Bubbles:**
- Sent: Background `#00F5FF` (cyan), text `#0A0E14`, right-aligned, rounded corners 16px
- Received: Background `#1E2433`, text `#E5E9F0`, left-aligned, rounded corners 16px
- Max width: 75% of screen
- Padding: 12px
- Include small encryption icon (lock) in corner
- Disappearing messages: Show countdown timer icon + remaining time

**Chat List Items:**
- Height: 72px
- Background: `#151B26` (pressable, active state: `#1E2433`)
- Border bottom: 1px `#2E3440`
- Layout: Avatar area (optional cipher icon) | Name + Preview | Time + Badge
- Unread badge: Background `#00F5FF`, text `#0A0E14`, circular

**Buttons:**
- Primary: Background `#00F5FF`, text `#0A0E14`, height 48px, rounded 8px
- Secondary: Border 1px `#00F5FF`, text `#00F5FF`, transparent background
- Destructive: Background `#FF4757`, text white
- Floating Action (if needed): Background `#00F5FF`, circular, shadow (0, 2, 0.10, 2)

**Input Fields:**
- Background: `#1E2433`
- Border: 1px `#2E3440`, focused: `#00F5FF`
- Text: `#E5E9F0`
- Placeholder: `#434C5E`
- Height: 48px, padding 12px, rounded 8px

**Status Indicators:**
- Connection dot: 8px circular, positioned in header/list items
- P2P: `#00FF88`, Relay: `#FFB800`, Offline: `#FF4757`
- Encryption icon: Small lock (Feather: lock), color `#B877FF`

### Interaction Design
- **Haptic Feedback:** On send message, on QR scan success, on destructive actions
- **Loading States:** Skeleton screens for chat list, shimmer effect for loading messages
- **Animations:** Smooth transitions (200ms) for tab switches, subtle fade-in for new messages
- **Pull-to-refresh:** On Chats List to check for new messages
- **Long-press:** On messages for "Delete for me" option, on IDs to copy

### Accessibility
- High contrast maintained (WCAG AA minimum)
- All touchable elements minimum 44x44pt
- Screen reader labels for icons (encryption status, connection indicators)
- Monospace fonts for IDs improve readability
- No critical information conveyed by color alone (use icons + text)

### Critical Assets
**None Required** - Use system/Feather icons exclusively:
- Tab icons: message-circle, user-plus, settings
- QR code: Generated programmatically
- Encryption/lock: Feather 'lock' icon
- Connection status: Colored dots (view component)
- Keep design minimal and icon-driven for privacy/security aesthetic