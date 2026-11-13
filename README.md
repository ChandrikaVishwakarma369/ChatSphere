# Real-Time Chat Application

A browser-based, one-to-one chat application. Users can register and sign in, find other registered users, exchange persisted messages in real time, share file attachments, receive notifications, and make audio or video calls.

The frontend is a React single-page application served by Vite. The backend is an Express REST API and Socket.IO server. PostgreSQL, accessed through Prisma, stores accounts, messages, call history, and notifications.

## Table of Contents

- [Project Overview](#project-overview)
- [Implemented Features](#implemented-features)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Installation and Setup](#installation-and-setup)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [API and Swagger Documentation](#api-and-swagger-documentation)
- [Real-Time Communication](#real-time-communication)
- [Audio and Video Calling](#audio-and-video-calling)
- [Database Models](#database-models)
- [Testing the Application](#testing-the-application)
- [Known Limitations and Future Improvements](#known-limitations-and-future-improvements)

## Project Overview

The application has two main parts:

- **Frontend (`frontend/`)**: React pages and components for registration, login, user discovery, chat, notifications, and call screens. Vite provides the development server and production build.
- **Backend (`backend/`)**: Express REST endpoints, JWT authentication, Prisma/PostgreSQL persistence, Redis-backed conversation-history caching, Cloudinary upload integration, Swagger UI, and Socket.IO messaging, presence, notifications, and call signaling.

Text messages, users, call records, and notifications are stored in PostgreSQL. WebRTC carries live audio/video media between participants; Socket.IO is used to coordinate signaling and call state.

## Implemented Features

### Accounts and user discovery

- Register with a full name, email, and password. Passwords are hashed with bcrypt before storage; email addresses are unique.
- Log in and receive a signed JWT that expires after one day. The frontend stores the token in `localStorage` and sends it for protected API requests and Socket.IO authentication.
- View other registered accounts and open one-to-one conversations.
- Log out by disconnecting the chat socket and clearing the locally stored token.

### Messaging and attachments

- Send one-to-one text messages over Socket.IO. Messages are persisted in PostgreSQL and conversation history can be loaded through the REST API.
- Track message states as `SENT`, `DELIVERED`, and `READ`. The chat UI uses one grey check for sent, two grey checks for delivered, and two blue checks for read.
- Select an attachment, preview its name and size, optionally include text, and submit it through the authenticated upload endpoint. The backend is implemented to upload files to Cloudinary and save file metadata with a message.
- Cache up to 50 recent messages for a conversation in Redis for five minutes. Text-message creation and message-status updates invalidate the corresponding cache.

> **Upload configuration note:** The upload route and Cloudinary upload flow are present, but `backend/src/config/cloudinary.js` currently sets the Cloudinary `secret_key` property. The Cloudinary Node SDK conventionally expects `api_secret`; verify this configuration with your Cloudinary account before relying on uploads. File upload behavior may fail until the configuration is corrected.

### Presence and notifications

- Show online/offline state for users and update presence in real time.
- Track a user's active Socket.IO connections so multiple tabs do not cause false offline status. A short disconnect grace period avoids a transient offline update during reconnection.
- Create persisted message and call notifications, display an unread count, and show notifications in the Notifications page.
- Mark one notification or all notifications as read. Notification changes and unread counts are synchronized to the user's connected tabs in real time.

### Audio and video calls

- Start audio or video calls from a one-to-one chat; receive, accept, reject, cancel, and end calls.
- Use WebRTC for peer media and Socket.IO for call offers, answers, ICE candidates, status updates, and signaling.
- Mute/unmute the microphone and turn the camera off/on during a video call.
- Save call history and statuses, and show call items in the conversation timeline. Call records include direction, audio/video mode, timestamps, status, and duration.
- Recover an active call after a page refresh by restoring call metadata from the tab's session storage and renegotiating the peer connection when both participants are ready. Active call coordination is held in backend memory and reconnect grace is limited; see [Audio and Video Calling](#audio-and-video-calling).
- Coordinate active-call UI between browser tabs with the browser `BroadcastChannel` API. A call is associated with its originating tab; other tabs are informed that the call is active elsewhere.

## Technology Stack

| Area | Technologies |
| --- | --- |
| Frontend | React 19, Vite 8, React Router, Axios |
| Styling and UI | Tailwind CSS 4, `lucide-react`, Google Fonts (Poppins and Redaction 10) |
| Backend | Node.js, Express 5 |
| Real-time communication | Socket.IO and `socket.io-client` |
| Database and ORM | PostgreSQL, Prisma 6 |
| Cache | Redis |
| File storage | Cloudinary |
| Calls | Browser WebRTC APIs (`RTCPeerConnection`, `getUserMedia`) |
| Authentication | JSON Web Tokens (`jsonwebtoken`), bcrypt |
| Upload handling | Multer |
| API documentation | OpenAPI 3, `swagger-jsdoc`, Swagger UI |
| Development tools | Vite, ESLint, Nodemon, concurrently |

The active database implementation uses Prisma and PostgreSQL. `backend/src/model/User.js` and `backend/src/model/Message.js` contain legacy Mongoose models and are not used by the active Prisma controllers.

## Project Structure

The following tree shows the application source, Prisma migrations, and key project files. It omits generated output, dependencies, and local `.env` files.

```text
real-time-chat-application/
├── package.json                  # Root development scripts (concurrently)
├── package-lock.json
├── README.md
├── backend/
│   ├── package.json
│   ├── server.js                 # Starts Express, PostgreSQL, Redis, and Socket.IO
│   ├── prisma.config.ts
│   ├── prisma/
│   │   ├── schema.prisma         # PostgreSQL models and enums
│   │   └── migrations/           # Checked-in database migrations
│   └── src/
│       ├── app.js                # Express middleware and route mounts
│       ├── config/               # Prisma, Redis, Cloudinary, Swagger
│       ├── controller/           # Auth, chat, users, and notifications
│       ├── middleware/           # JWT authorization and Multer upload
│       ├── model/                # Legacy Mongoose models (not active)
│       ├── route/                # REST route definitions
│       ├── service/              # Message cache and notification services
│       ├── socket/               # Socket.IO messaging, presence, call signaling
│       └── utils/                # Cloudinary upload helper
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── public/                   # Static icons and favicon
    └── src/
        ├── App.jsx               # Routes and global call/notification providers
        ├── main.jsx
        ├── index.css
        ├── socket.js             # Shared authenticated Socket.IO client
        ├── components/           # Call screens and notifications UI
        ├── context/              # Call and notification state
        ├── pages/                # Home, chat, login, and registration
        └── assets/
```

The Prisma migrations in `backend/prisma/migrations/` currently include:

- `20261023095501_init`
- `20261026122220_file_upload`
- `20261028050602_cloudinary_file_publicid`
- `20261104123120_add_message_status`
- `20261111101518_add_call_history`
- `20261111134334_add_notifications`
- `20261112120000_extend_notifications_for_calls`

## Installation and Setup

### Prerequisites

- Node.js and npm.
- PostgreSQL and a database that the application can access.
- Redis reachable by the backend.
- A Cloudinary account if you intend to use file uploads.
- A modern browser with WebRTC support. Camera and microphone access requires `localhost` during local development or HTTPS in a deployed environment.

### Clone and install

```bash
git clone https://github.com/chandrikavishwakarma/real-time-chat-application.git
cd real-time-chat-application
npm install
```

The root install provides `concurrently`. Install the frontend and backend dependencies as well:

```bash
cd backend
npm install
cd ../frontend
npm install
cd ..
```

### Configure PostgreSQL and Prisma

1. Create a PostgreSQL database, for example `real_time_chat`.
2. Create `backend/.env` and set `DATABASE_URL` (see [Environment Variables](#environment-variables)).
3. Apply the checked-in migrations and generate Prisma Client from the `backend/` directory:

```bash
cd backend
npx prisma migrate dev
npx prisma generate
```

For an environment where migrations have already been created and committed, use `npx prisma migrate deploy` to apply them without creating a development migration.

### Configure Redis

Set `REDIS_URL` in `backend/.env` to a running Redis instance. For a local instance, use:

```dotenv
REDIS_URL=redis://localhost:6379
```

The backend connects to PostgreSQL and Redis before listening for requests. Configure this variable rather than relying on the fallback URL in the source.

### Configure Cloudinary

Set `CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_SECRET` in `backend/.env` with credentials from your Cloudinary account. Do not commit the values. As noted above, verify the `secret_key` configuration property in `backend/src/config/cloudinary.js`; uploads may not work with the current property name.

## Environment Variables

Create `backend/.env` with the following variable names. All values shown are examples/placeholders, not real credentials:

```dotenv
DATABASE_URL="postgresql://your_db_user:your_db_password@localhost:5432/real_time_chat?schema=public"
JWT_SECRET=replace_with_a_long_random_secret
PORT=5000
REDIS_URL=redis://localhost:6379

# Required only when using Cloudinary uploads
CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_SECRET=your_cloudinary_api_secret
```

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by Prisma. |
| `JWT_SECRET` | Yes | Secret used to sign and verify one-day JWTs. |
| `PORT` | No | HTTP and Socket.IO port; defaults to `5000`. |
| `REDIS_URL` | Yes for startup | Redis connection URL. The backend attempts to connect to Redis during startup. |
| `CLOUD_NAME` | For uploads | Cloudinary cloud name. |
| `CLOUDINARY_API_KEY` | For uploads | Cloudinary API key. |
| `CLOUDINARY_SECRET` | For uploads | Cloudinary secret read by the current application configuration. |

The frontend optionally reads `VITE_API_URL`. Create `frontend/.env` for a non-default backend URL:

```dotenv
VITE_API_URL=http://localhost:5000
```

The frontend falls back to `http://localhost:5000`. The login and registration pages currently use that address directly, so changing `VITE_API_URL` alone does not reconfigure those two pages.

Never put real secrets, passwords, database credentials, or API credentials in this README or commit local `.env` files.

## Running the Application

Once dependencies, PostgreSQL, Redis, migrations, and environment variables are configured, start both development servers from the repository root:

```bash
npm run dev
```

The root script runs the backend and frontend scripts concurrently. By default:

- Frontend: `http://localhost:5173`
- Backend REST API and Socket.IO: `http://localhost:5000`

You can also run each application in a separate terminal:

```bash
# Terminal 1
cd backend
npm run dev
```

```bash
# Terminal 2
cd frontend
npm run dev
```

Available frontend scripts, run from `frontend/`:

```bash
npm run build
npm run lint
npm run preview
```

To inspect the database with Prisma Studio, run from `backend/`:

```bash
npx prisma studio
```

The root `npm test` command is currently a placeholder that exits with an error; automated tests are not configured.

## API and Swagger Documentation

Start the backend and open Swagger UI at **[http://localhost:5000/api-docs](http://localhost:5000/api-docs)**. The OpenAPI server is configured as `http://localhost:5000`. Swagger annotations currently cover the documented authentication, user, chat, upload, and call-history routes. The notification routes are implemented but do not currently have Swagger annotations.

### Authentication

Registration and login are public. Protected REST endpoints require:

```http
Authorization: Bearer <JWT>
```

To authorize in Swagger UI, call `POST /api/auth/login`, copy the returned `token`, choose **Authorize**, and enter the token for the `bearerAuth` scheme. The same JWT is supplied to the Socket.IO handshake by the frontend.

### REST endpoints

| Method | Endpoint | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Register with `Fullname`, `Email`, and `Password`. |
| `POST` | `/api/auth/login` | Public | Log in with `Email` and `Password`; returns a JWT and user details. |
| `GET` | `/api/users` | Public | Return the registered users' IDs, names, and email addresses. |
| `GET` | `/api/chat/users` | Bearer JWT | Return the authenticated user and the other chat users. |
| `GET` | `/api/chat/{userId}/messages` | Bearer JWT | Return the conversation with the specified user (up to 50 recent messages from the cache/database path). |
| `POST` | `/api/chat/{userId}/upload` | Bearer JWT | Multipart upload with required `file` and optional `text`. |
| `GET` | `/api/chat/{userId}/calls` | Bearer JWT | Return incoming and outgoing call history with that user. |
| `GET` | `/api/notifications` | Bearer JWT | Return the authenticated user's notifications and unread count. |
| `PATCH` | `/api/notifications/{id}/read` | Bearer JWT | Mark one notification as read. |
| `PATCH` | `/api/notifications/read-all` | Bearer JWT | Mark all of the authenticated user's notifications as read. |

Text messages and call actions use Socket.IO events rather than REST endpoints. The notification endpoints are active in the application, but are not currently described in Swagger UI.

## Real-Time Communication

The frontend uses a shared Socket.IO client in `frontend/src/socket.js`. The client sends its JWT and a per-tab ID during the handshake. The backend verifies the token, checks that the user exists, and joins the socket to that user's room.

### Messaging and message status

1. A sender emits `send_message` with a `receiverId` and message `text`.
2. The backend validates the receiver and text, stores the message in PostgreSQL as `SENT`, invalidates the conversation cache, and emits `new_message` to both participants' user rooms.
3. When the receiving client processes the message, it emits `message_delivered` with the message ID. The backend records `DELIVERED` and emits `message_status_updated` to the sender.
4. When the receiver has the conversation open in a visible tab, the client emits `message_read` for delivered messages. The backend records `READ` and sends a status update to the sender.

Message history is loaded over REST and merged with live Socket.IO events by message ID. Redis caches the latest 50 messages for a conversation for 300 seconds. Text-message creation and status changes invalidate the cache; attachment uploads currently do not use that invalidation helper.

### Online presence

The server tracks each user's active sockets. On connection it sends the current `online_users` list, and broadcasts `user_status_changed` when a user goes online or offline. A user remains online while any tab is connected. The server applies a brief disconnect grace period before announcing offline, allowing a reconnect to cancel the transition.

### Notifications

Message and call notifications are persisted in PostgreSQL and emitted to the recipient's user room. The frontend updates the notification list and unread badge from `new_notification` and `notification_updated` events. Marking one or all notifications read updates the stored state and synchronizes the unread count across the user's connected tabs.

## Audio and Video Calling

Call controls are available from the selected user's chat. The caller emits `call_user`; the backend checks that the receiver is online and neither participant is already in a call, creates a call-history record, notifies the receiver, and sends an incoming-call event to the receiver's selected tab. Calls that remain unanswered are marked missed after 45 seconds.

The callee can accept or reject. When accepted, the caller creates a WebRTC offer, the callee returns an answer, and both participants exchange ICE candidates through Socket.IO. Once negotiated, the browser's WebRTC peer connection carries the audio/video media directly between the clients. The application currently configures Google's public STUN servers; it does not configure a TURN relay.

### Permissions and controls

- The browser prompts for microphone access on audio calls and microphone plus camera access on video calls.
- Calls need a secure browser context: `localhost` is supported for local development; deployed use requires HTTPS.
- The call screen provides microphone mute/unmute, camera off/on for video, and an end-call control. The caller's ringing screen offers **Cancel Call**; the recipient's incoming-call screen offers **Accept** and **Reject**.
- If permissions are denied or a device is missing or unavailable, the UI presents an explanatory message.
- The backend rejects calls to offline or busy users. A receiver must be online to receive an incoming call.

### Call history, recovery, and tabs

Call history is stored in the `Call` model and returned by `GET /api/chat/{userId}/calls`. The conversation view merges call records with messages and displays call type, status, direction, time, and duration. Call statuses include `RINGING`, `ACCEPTED`, `COMPLETED`, `MISSED`, `REJECTED`, `CANCELLED`, and `FAILED`.

The active call ID and participant details are saved in the originating tab's `sessionStorage`. If that tab reconnects, the server can restore the call and ask both participants to rebuild their WebRTC peer connections and media streams. Recovery is limited by the server's 30-second reconnect grace period and requires both participants to reconnect and grant any requested media permissions. Active-call coordination is held in server memory, so a backend process restart ends the in-memory call state even though the persisted call-history record remains.

Browser tabs coordinate call UI through `BroadcastChannel`. A call belongs to its original tab; another tab can be informed that a call is active elsewhere rather than taking over its media session.

## Database Models

The active schema is `backend/prisma/schema.prisma`. Prisma migrations are stored in `backend/prisma/migrations/`.

| Model / enum | Purpose and important fields |
| --- | --- |
| `User` | Account with integer `id`, `Fullname`, unique `Email`, and bcrypt-hashed `Password`. Has relations for sent/received messages, incoming/outgoing calls, and sent/received notifications. |
| `Message` | One-to-one chat item: `senderId`, `receiverId`, `text` (up to 5,000 characters), optional file metadata (`fileName`, `fileUrl`, `fileType`, `fileSize`, `publicId`), `createdAt`, and `updatedAt`. `status` defaults to `SENT`; `deliveredAt` and `readAt` record status timestamps. |
| `MessageStatus` | `SENT`, `DELIVERED`, or `READ`. |
| `Call` | Persisted call record with unique `callId`, `callerId`, `receiverId`, audio/video flag `video`, `status`, `startedAt`, optional `answeredAt` and `endedAt`, and `duration` in seconds. |
| `CallStatus` | `RINGING`, `ACCEPTED`, `COMPLETED`, `MISSED`, `REJECTED`, `CANCELLED`, or `FAILED`. |
| `Notification` | Notification recipient `userId`, sender `senderId`, optional linked `messageId` or `callId`, `type`, `isRead`, and `createdAt`. Types used by the application include `MESSAGE`, audio/video call, missed, rejected, completed, cancelled, and failed call notifications. |

Message and call records relate to their sender/caller and receiver/callee through separate `User` relations. Deleting a related user cascades to associated records. Notifications can be linked to a message or call and are indexed for recipient/read-state/time queries.

## Testing the Application

The repository does not currently include an automated test suite. Use two test accounts in separate browser profiles or browsers and verify the flows manually.

1. **Registration and login:** Open `http://localhost:5173/register`, create two accounts with different email addresses, and log in as one at `/login`. Confirm the home page lists the other account. Repeat in the second browser profile with the other account.
2. **Messaging:** From the home page, select the other user and send a text message. Confirm it appears in the sender's chat and the other user's open chat without refreshing. Reload the conversation and confirm history is still present.
3. **Delivery and read states:** Keep the receiver logged in and connected; send a message and confirm the sender's status progresses to delivered. Open the conversation in the receiver's visible tab and confirm the sender sees read status. A message should not be marked read just because the receiver has the page hidden or a different conversation open.
4. **File uploads:** Configure Cloudinary and verify the SDK secret setting described above. In a chat, attach a file, optionally add text, press **Send**, and confirm the saved attachment appears for both participants and in conversation history.
5. **Presence:** Keep one user's chat open, then connect and disconnect the other account. Confirm the user's online/offline indicator updates; also check with the same account open in multiple tabs.
6. **Notifications:** Send a message or call the other user. Open the Notifications page, confirm the notification and unread count, then mark one or all notifications read and check the badge.
7. **Audio and video calls:** In the receiver's online browser, initiate an audio call and then a video call from the other account's chat. Grant browser permissions and verify media, mute/unmute, camera toggling, and ending the call.
8. **Accept/reject/cancel:** Accept an incoming call and end it. For separate attempts, reject a call and cancel an outgoing ringing call. Let one ring unanswered to verify the missed-call result. Confirm call status and history update in the conversation.
9. **Offline/busy calls:** Try calling an offline account, then try placing a second call while a participant is already on a call. Confirm the application reports offline or busy rather than starting another call.
10. **Call recovery after refresh:** During an accepted call, refresh the original call tab and allow it to reconnect within the 30-second server grace period. Grant media permissions again if prompted. Recovery requires both call participants to be available for the renegotiation.
11. **Swagger REST requests:** Visit [http://localhost:5000/api-docs](http://localhost:5000/api-docs), log in to obtain a token, select **Authorize**, and exercise the documented endpoints. Use a multipart `file` field for the upload route.

## Known Limitations and Future Improvements

The following items are not represented as completed features:

- Verify/fix Cloudinary API-secret configuration and add explicit upload size and file-type validation.
- Add Redis cache invalidation for attachment uploads.
- Configure a TURN service for WebRTC networks where direct peer connections using STUN cannot be established.
- Add automated backend, frontend, and end-to-end tests.
- Add pagination for long conversation histories and call-history lists.
- Add Swagger annotations for the notification routes and keep generated response schemas aligned with actual handler behavior.
- Persist active call coordination outside the backend process if calls must survive a server restart.
