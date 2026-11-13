const express = require("express");
const { prisma } = require("../config/db.js");

const router = express.Router();

const {
  getChatUsers,
  getMessages,
  uploadFile,
} = require("../controller/chatController.js");

const authMiddleware = require("../middleware/authMiddleware.js");
const upload = require("../middleware/uploadMiddleware.js");

/**
 * @swagger
 * /api/chat/users:
 *   get:
 *     summary: Get all registered chat users
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged-in user and other registered users
 *       401:
 *         description: Unauthorized
 */
router.get("/users", authMiddleware, getChatUsers);

/**
 * @swagger
 * /api/chat/{userId}/messages:
 *   get:
 *     summary: Get messages between the logged-in user and another user
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Messages fetched successfully
 *       400:
 *         description: Invalid user ID or self-chat is not allowed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get("/:userId/messages", authMiddleware, getMessages);

/**
 * @swagger
 * /api/chat/{userId}/upload:
 *   post:
 *     summary: Upload a file to a chat
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               text:
 *                 type: string
 *     responses:
 *       201:
 *         description: File uploaded and message saved
 *       400:
 *         description: Invalid user ID or missing file
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/:userId/upload",
  authMiddleware,
  upload.single("file"),
  uploadFile,
);

/**
 * @swagger
 * /api/chat/{userId}/calls:
 *   get:
 *     summary: Get audio and video call history with another user
 *     description: Returns incoming and outgoing calls in chronological order. Call records are stored permanently in the database.
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The other participant's user ID
 *     responses:
 *       200:
 *         description: Call history retrieved successfully
 *       400:
 *         description: Invalid ID or self-call history is not allowed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Unable to fetch call history
 */
router.get("/:userId/calls", authMiddleware, async (req, res) => {
  try {
    const currentUserId = Number(req.user?.id);
    const peerId = Number(req.params.userId);

    if (!Number.isSafeInteger(currentUserId) || currentUserId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid authenticated user",
      });
    }

    if (!Number.isSafeInteger(peerId) || peerId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (currentUserId === peerId) {
      return res.status(400).json({
        success: false,
        message: "You cannot fetch call history with yourself",
      });
    }

    const peer = await prisma.user.findUnique({
      where: { id: peerId },
      select: { id: true },
    });

    if (!peer) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const calls = await prisma.call.findMany({
      where: {
        OR: [
          {
            callerId: currentUserId,
            receiverId: peerId,
          },
          {
            callerId: peerId,
            receiverId: currentUserId,
          },
        ],
      },
      orderBy: {
        startedAt: "asc",
      },
      include: {
        caller: {
          select: {
            id: true,
            Fullname: true,
          },
        },
        receiver: {
          select: {
            id: true,
            Fullname: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      calls,
    });
  } catch (error) {
    console.error("Call history error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch call history",
    });
  }
});

module.exports = router;