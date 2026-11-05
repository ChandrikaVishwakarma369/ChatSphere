# Real-Time Chat Application

A browser-based chat application for private, one-to-one conversations. Users can register, log in, select another registered user, and exchange messages in real time. User accounts and messages are stored in PostgreSQL through Prisma. The application also includes a chat attachment upload flow using Cloudinary.

## Features

- **User registration and login:** Register an account and log in with email and password. Passwords are hashed with bcrypt.
- **JWT authentication:** JWTs protect chat REST endpoints and authenticate Socket.IO connections.
- **Real-time one-to-one messaging:** Send messages to another registered user through Socket.IO. Messages and conversation history are persisted in PostgreSQL.
- **SENT status:** A newly stored message is marked `SENT` and shown to its sender with one grey checkmark.
- **DELIVERED status:** When the receiver's client receives a message, the status becomes `DELIVERED` and the sender sees two grey checkmarks.
- **READ status:** When the receiver opens the conversation (or returns to its visible browser tab), eligible incoming messages become `READ`; the sender sees two blue checkmarks.
- **Online/offline user status:** The chat page displays the selected user's current presence.
- **Real-time presence updates:** Connected clients receive user status changes without refreshing the page.
- **Multiple users and browser sessions:** Presence is tracked per user across simultaneous sockets, such as multiple tabs. A short disconnect grace period avoids a false offline transition during reconnection.
- **File uploads:** Chat attachments are accepted through the upload endpoint, with Cloudinary used for file storage.
- **PostgreSQL and Prisma:** Users, messages, file metadata, and message statuses use the Prisma data model and migrations.
- **Redis message caching:** Recent conversation history is cached (up to 50 messages for five minutes).
- **Swagger/OpenAPI documentation:** The REST API is described and available through Swagger UI.

## Technology Stack

| Area | Technologies |
| --- | --- |
| Frontend | React.js, Vite, Tailwind CSS |
| Backend | Node.js, Express.js |
| Real-time communication | Socket.IO |
| Database | PostgreSQL |
| ORM | Prisma |
| Caching | Redis |
| File storage | Cloudinary |
| Authentication | JWT |
| API documentation | Swagger/OpenAPI, Swagger UI |

The backend also uses bcrypt for password hashing and Multer to receive uploaded files. Mongoose and the files under `backend/src/model/` are remnants of an earlier implementation; the active database layer uses Prisma and PostgreSQL.

## Project Structure

The tree below reflects the project files and omits installed dependencies (`node_modules`) and local environment files (`.env`).

```text
real-time-chat-application/
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
├── backend/
│   ├── .gitignore
│   ├── package.json
│   ├── package-lock.json
│   ├── prisma.config.ts
│   ├── server.js
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   │       ├── migration_lock.toml
│   │       ├── 20261023095501_init/
│   │       │   └── migration.sql
│   │       ├── 20261026122220_file_upload/
│   │       │   └── migration.sql
│   │       ├── 20261028050602_cloudinary_file_publicid/
│   │       │   └── migration.sql
│   │       └── 20261104123120_add_message_status/
│   │           └── migration.sql
│   └── src/
│       ├── app.js
│       ├── config/
│       │   ├── cloudinary.js
│       │   ├── db.js
│       │   ├── redis.js
│       │   └── swagger.js
│       ├── controller/
│       │   ├── authController.js
│       │   ├── chatController.js
│       │   └── userController.js
│       ├── middleware/
│       │   ├── authMiddleware.js
│       │   └── uploadMiddleware.js
│       ├── model/
│       │   ├── Message.js
│       │   └── User.js
│       ├── route/
│       │   ├── authRoute.js
│       │   ├── chatRoutes.js
│       │   └── userRoutes.js
│       ├── service/
│       │   └── messageCache.js
│       ├── socket/
│       │   └── chatSocket.js
│       └── utils/
│           └── uploadCloudinaryFile.js
└── frontend/
    ├── .gitignore
    ├── README.md
    ├── README.md
    ├── eslint.config.js
    ├── index.html
    ├── package.json
    ├── package-lock.json
    ├── vite.config.js
    ├── public/
    │   ├── favicon.svg
    │   └── icons.svg
    └── src/
        ├── App.jsx
        ├── index.css
        ├── main.jsx
        ├── socket.js
        ├── assets/
        │   ├── hero.png
        │   ├── react.svg
        │   └── vite.svg
        └── pages/
            ├── Chat.jsx
            ├── Home.jsx
            ├── Login.jsx
            └── Register.jsx
```

## Installation and Setup

### Prerequisites

- Node.js and npm.
- PostgreSQL, with permission to create tables in the selected database.
- Redis, which must be reachable before starting the backend.
- A Cloudinary account and credentials to use attachment uploads.

### Install dependencies

Run each command from the project root unless noted:

```bash
npm install
```

Install backend dependencies:

```bash
cd backend
npm install
```

In a separate terminal, install frontend dependencies:

```bash
cd frontend
npm install
```

### Configure PostgreSQL and Prisma

1. Create a PostgreSQL database, for example `real_time_chat`.
2. Set `DATABASE_URL` in `backend/.env` to the connection string for that database. See the [Environment Variables](#environment-variables) section.
3. From the `backend` directory, apply the checked-in migrations and generate Prisma Client:

```bash
npx prisma migrate dev
npx prisma generate
```

For an environment where migrations have already been created and committed, use `npx prisma migrate deploy` instead of `npx prisma migrate dev`.

### Configure Redis and Cloudinary

Set `REDIS_URL` to a running Redis instance in `backend/.env`. A local Redis instance commonly uses `redis://localhost:6379`. The backend connects to PostgreSQL and Redis before it begins listening, so both services must be available at startup.

Set the three Cloudinary variables in `backend/.env` to use uploads. Keep the values private. The current Cloudinary configuration passes `CLOUDINARY_SECRET` through a `secret_key` property; the Cloudinary SDK commonly expects `api_secret`. Verify this configuration before relying on uploads.

## Environment Variables

Create or update `backend/.env` with the following names. The values below are safe placeholders, not working credentials:

```dotenv
DATABASE_URL="postgresql://<USER>:<PASSWORD>@localhost:5432/real_time_chat?schema=public"
JWT_SECRET=replace-with-a-long-random-secret
PORT=5000
REDIS_URL=redis://localhost:6379

# Required only for Cloudinary uploads:
CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_SECRET=your-cloudinary-api-secret
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by Prisma. |
| `JWT_SECRET` | Yes | Secret used to sign and verify JWTs. |
| `PORT` | No | Backend port; defaults to `5000`. |
| `REDIS_URL` | Yes for backend startup | Redis connection URL. |
| `CLOUD_NAME` | For uploads | Cloudinary cloud name. |
| `CLOUDINARY_API_KEY` | For uploads | Cloudinary API key. |
| `CLOUDINARY_SECRET` | For uploads | Cloudinary secret variable read by the current configuration. |

For frontend development, create or update `frontend/.env`:

```dotenv
VITE_API_URL=http://localhost:5000
```

`VITE_API_URL` is used by the home and chat pages; the login and registration pages currently use `http://localhost:5000` directly. Socket.IO's allowed frontend origin is also set to `http://localhost:5173` in `backend/server.js`.

Do not put real passwords, JWT secrets, or service credentials in this README or commit local `.env` files.

## Running the Application

### Start both applications from the project root

After installing the root, backend, and frontend dependencies and completing the database and service configuration, run:

```bash
npm run dev
```

The root `dev` script uses `concurrently` to run the backend and frontend development scripts together. The backend listens on port `5000` by default, and Vite normally serves the frontend at `http://localhost:5173`.

The root package also provides individual scripts if you want to start only one side:

```bash
npm run dev:server
npm run dev:client
```

### Start services separately

From `backend`:

```bash
npm run dev
```

From `frontend`, in another terminal:

```bash
npm run dev
```

The frontend package also provides these scripts, run from `frontend`:

```bash
npm run build
npm run lint
npm run preview
```

## Swagger API Documentation

Swagger documentation is implemented for all backend REST routes. Start the backend, then open [http://localhost:5000/api-docs](http://localhost:5000/api-docs) in a browser. The Swagger UI is served by Express and describes the API operations defined in the backend route files.

### Authorize protected requests

1. Use `POST /api/auth/login` in Swagger UI to log in and copy the returned `token`.
2. Select **Authorize** in Swagger UI.
3. Enter the JWT token in the `bearerAuth` field and confirm. Swagger UI applies it as a Bearer authorization header.
4. Execute the protected chat endpoints. Select **Logout** in the authorization dialog when finished.

### REST endpoints

All routes use the `http://localhost:5000` server defined in the Swagger configuration.

| Group | Method | Endpoint | Authentication | Request |
| --- | --- | --- | --- | --- |
| Authentication | `POST` | `/api/auth/register` | Public | JSON body: `Fullname`, `Email`, `Password` |
| Authentication | `POST` | `/api/auth/login` | Public | JSON body: `Email`, `Password` |
| Users | `GET` | `/api/users` | Public | None |
| Chat | `GET` | `/api/chat/users` | Bearer JWT | None |
| Chat | `GET` | `/api/chat/{userId}/messages` | Bearer JWT | `userId` path parameter |
| File Upload | `POST` | `/api/chat/{userId}/upload` | Bearer JWT | Multipart form with required `file` and optional `text` |

`POST /api/auth/login` returns the JWT used for protected endpoints. The upload route stores file metadata with a message, but its Cloudinary configuration should be verified as noted above. The upload controller currently returns HTTP `201`, although its Swagger annotation lists `200`; the message-history controller returns a JSON array, while its Swagger response schema describes an object. These response annotations should be aligned with the actual handler responses.

Text messages are sent over Socket.IO rather than a REST endpoint. The client authenticates its Socket.IO connection using the JWT and emits `send_message` with `receiverId` and `text`; the server broadcasts saved messages using `new_message`.

### Message Status Workflow

The chat page uses a reusable Socket.IO client authenticated with the JWT. Historical messages are loaded from `GET /api/chat/{userId}/messages` and merged by message ID with live events.

1. **SENT:** The sender emits `send_message` with `{ receiverId, text }`. The server stores the message in PostgreSQL with status `SENT`, sends it to the sender and receiver using `new_message`, and acknowledges success. The sender sees one grey checkmark.
2. **DELIVERED:** When the incoming message reaches the receiver's client, it emits `message_delivered` with `{ messageId }`. The server changes the status to `DELIVERED` and sends `message_status_updated` to the sender. The sender sees two grey checkmarks.
3. **READ:** When the receiver opens the conversation or returns to its visible browser tab, eligible incoming message IDs are emitted as `message_read` with `{ messageIds: [...] }`. The server stores the `READ` status and notifies the sender with `message_status_updated`. The sender sees two blue checkmarks.

The checkmarks are displayed on the sender's messages: **one grey** means sent and stored; **two grey** means delivered to the receiver's client; **two blue** means read by the receiver in the conversation.

## Online/Offline Status Workflow

Socket.IO authenticates each connection with the user's JWT and associates that socket with the authenticated user. The server keeps a set of active socket connections for each user.

- A user becomes **ONLINE** when their first socket connects. The server broadcasts a `user_status_changed` event with `ONLINE` to other connected users and sends the connecting client the current `online_users` list.
- A user becomes **OFFLINE** after their last active socket disconnects and remains disconnected through a one-second grace period. The server then broadcasts `user_status_changed` with `OFFLINE`.
- If another tab remains connected, the user stays online. If a socket reconnects during the grace period, the pending offline transition is cancelled, preventing a brief false offline update.
- The chat page listens for the current online-user list and real-time status changes, then displays **Online** or **Offline** for the selected user in the chat interface.
- On a Socket.IO reconnection, the client can request the current online-user list again so its presence display can be refreshed.

## Database Management

The Prisma schema is in `backend/prisma/schema.prisma`, and checked-in database migrations are in `backend/prisma/migrations/`. To inspect tables and records with Prisma Studio, run this from the `backend` directory:

```bash
npx prisma studio
```

## Testing APIs

Use Swagger UI at [http://localhost:5000/api-docs](http://localhost:5000/api-docs) to test the REST APIs:

1. Register a user, then log in to obtain a JWT.
2. Select **Authorize** and provide the JWT before running protected endpoints.
3. Test chat user listing and conversation history with a valid other user's ID.
4. To test file uploads, use the multipart `file` field (and optionally `text`) on the upload endpoint, with valid Cloudinary configuration.

The root `test` script is currently a placeholder that exits with an error; use the Swagger UI for manual API testing.

## Future Improvements

- Correct and verify the Cloudinary SDK secret configuration and add server-side upload size and file-type validation.
- Broadcast uploaded-file messages through Socket.IO and invalidate the affected Redis history cache.
- Align Swagger response schemas and status codes with the actual route handlers.
- Add automated backend and end-to-end tests, plus pagination for long conversation histories.
- Add optional chat capabilities such as typing indicators.
