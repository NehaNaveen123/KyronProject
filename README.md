# Kyron Medical — AI Appointment Scheduler

A production-ready MVP where patients chat with an AI assistant to schedule medical appointments, with voice handoff via Vapi.

## Architecture overview

```
app/                     Next.js App Router pages
  page.tsx               Main chat interface
  admin/page.tsx         Admin availability dashboard
  layout.tsx / globals.css

components/
  ChatBubble.tsx         Single message bubble
  ChatInput.tsx          Textarea + send button
  VoiceHandoffButton.tsx Vapi web-call trigger + overlay

lib/
  db.ts                  Singleton Prisma client
  ai.ts                  OpenAI client, system prompt, tool definitions
  tools.ts               Tool implementations (getAvailability, bookAppointment)
  vapi.ts                Vapi API helpers (web call + phone call)

pages/api/
  chat.ts                POST — main AI chat endpoint
  conversation.ts        GET  — restore history on page reload
  voice-handoff.ts       POST — trigger Vapi call
  admin/
    doctors.ts           GET  — list doctors + availability
    availability.ts      POST/DELETE/PATCH — manage slots

prisma/
  schema.prisma          DB schema
  seed.ts                Seeds 4 doctors + 45 days of slots
```

---

## Local setup

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ running locally (or a managed instance)

### 1. Clone and install

```bash
git clone <repo-url> kyron-medical
cd kyron-medical
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL="postgresql://postgres:password@localhost:5432/kyron_medical"

GROQ_API_KEY="gsk_..."

# Vapi — create a free account at https://vapi.ai, copy your Public Key
VAPI_API_KEY="..."                        # Server-side secret key
NEXT_PUBLIC_VAPI_PUBLIC_KEY="..."         # Client-side public key (for SDK)

NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

> **Vapi notes:** The free tier supports web calls (in-browser). For outbound phone calls you additionally need `VAPI_PHONE_NUMBER_ID` (provision a number in the Vapi dashboard).

### 3. Set up the database

```bash
# Create the database
createdb kyron_medical

# Push the Prisma schema (creates tables)
npm run db:push

# Seed: creates 4 doctors + 45 days of weekday slots
npm run db:seed
```

### 4. Run the dev server

```bash
npm run dev
# → http://localhost:3000
```

- **Chat:** http://localhost:3000
- **Admin:** http://localhost:3000/admin

---

## Key flows

### Chat + AI tool calling

1. User sends a message → `POST /api/chat`
2. Server loads conversation from DB, appends user message
3. OpenAI `gpt-4o` runs with two tools defined:
   - `getAvailability(specialty)` → queries `Availability` table
   - `bookAppointment(...)` → atomically books slot + creates `Appointment`
4. If the model calls a tool, the server executes it and loops back to OpenAI
5. Final text response saved to DB + returned to client

### Voice handoff

1. User clicks **Continue via phone** → `POST /api/voice-handoff`
2. Server builds a voice system prompt from the full conversation history
3. Server calls Vapi API to create a web call (browser-based, no phone number required)
4. Frontend uses `@vapi-ai/web` SDK to connect the microphone
5. Voice assistant picks up exactly where text chat left off

### Session persistence

- `sessionId` is stored in `localStorage` and sent with every request
- On page reload, `GET /api/conversation?sessionId=xxx` restores the full message list
- Admin changes (add/delete/toggle slots) are reflected immediately on next AI tool call

---

## Deploy to AWS EC2 with HTTPS

### 1. Launch EC2 instance

- AMI: Ubuntu 22.04 LTS
- Instance type: t3.small or larger
- Open ports: 22 (SSH), 80 (HTTP), 443 (HTTPS)

### 2. Install dependencies on the server

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (process manager)
sudo npm install -g pm2

# Nginx
sudo apt-get install -y nginx

# PostgreSQL (or use Amazon RDS — recommended for production)
sudo apt-get install -y postgresql postgresql-contrib
```

### 3. Configure PostgreSQL

```bash
sudo -u postgres psql
CREATE DATABASE kyron_medical;
CREATE USER kyron WITH PASSWORD 'strongpassword';
GRANT ALL PRIVILEGES ON DATABASE kyron_medical TO kyron;
\q
```

### 4. Deploy the app

```bash
# On server: clone repo
git clone <repo-url> /home/ubuntu/kyron-medical
cd /home/ubuntu/kyron-medical

# Copy your .env
nano .env   # fill in production values

# Install, migrate, seed
npm install
npm run db:push
npm run db:seed

# Build
npm run build

# Start with PM2
pm2 start npm --name "kyron-medical" -- start
pm2 save
pm2 startup   # follow the printed command to enable on boot
```

### 5. Configure Nginx as reverse proxy

```bash
sudo nano /etc/nginx/sites-available/kyron-medical
```

```nginx
server {
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kyron-medical /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Enable HTTPS with Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# Certbot auto-renews — cron job is added automatically
```

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GROQ_API_KEY` | Yes | Groq API key (console.groq.com) |
| `VAPI_API_KEY` | Yes (voice) | Vapi server-side secret key |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | Yes (voice) | Vapi public key for browser SDK |
| `VAPI_PHONE_NUMBER_ID` | Optional | For outbound phone calls |
| `NEXT_PUBLIC_APP_URL` | Yes | Full URL of the deployed app |
| `SENDGRID_API_KEY` | Optional | For email confirmations |
| `SENDGRID_FROM_EMAIL` | Optional | Sender email for confirmations |

---

## Non-happy path handling

The AI handles these gracefully:
- **No slots for requested time** — AI calls `getAvailability`, sees the empty/filtered list, and suggests alternatives ("I don't see any Tuesday morning slots, but I do have Monday at 10am or Wednesday at 2pm")
- **Slot taken mid-booking** — `bookAppointment` returns `{ error, alternatives }`, AI presents alternatives
- **Unsupported specialty** — AI declines and redirects to primary care physician
- **Medical advice requests** — AI refuses and redirects to the doctor appointment

---

## Doctors seeded

| Name | Specialty |
|---|---|
| Dr. Sarah Chen | Cardiology |
| Dr. Michael Torres | Dermatology |
| Dr. Emily Johnson | Orthopedics |
| Dr. David Kim | Neurology |

Each doctor gets 7 slots per weekday (9am–4pm, excl. 12pm) for 45 days = ~1,400 slots total.
