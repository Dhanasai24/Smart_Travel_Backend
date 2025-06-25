import jwt from "jsonwebtoken"
import pool from "./config/database.js"

// In-memory store for active users and rooms
const activeUsers = new Map() // userId -> socketId
const userRooms = new Map() // userId -> Set of roomIds
const roomUsers = new Map() // roomId -> Set of userIds
const userProfiles = new Map() // userId -> user profile data

// ✅ ENHANCED: Track recent connection requests to prevent duplicates
const recentConnectionRequests = new Map() // "fromUserId_toUserId" -> timestamp

// Main socket handler function
export function registerSocketHandlers(io, socket) {
  console.log(`🔌 User connected: ${socket.id}`)

  // ✅ ENHANCED: Register user and deliver offline notifications
  socket.on("register-user", async (data) => {
    try {
      const userId = Number.parseInt(data.userId)
      const { token, userInfo } = data

      socket.userId = userId
      activeUsers.set(userId, socket.id)
      socket.join(`user_${userId}`)

      console.log(`👤 User ${userId} registered with socket ${socket.id}`)

      // Load user profile if not already loaded
      if (!userProfiles.has(userId)) {
        try {
          const userResult = await pool.query(`SELECT id, name, email, avatar_url FROM users WHERE id = $1`, [userId])
          if (userResult.rows.length > 0) {
            const userProfile = userResult.rows[0]
            socket.user = userProfile
            userProfiles.set(userId, userProfile)
            console.log(`✅ User profile loaded: ${userProfile.name} (${userProfile.id})`)
          }
        } catch (dbError) {
          console.warn("⚠️ Could not load user profile from database:", dbError.message)
          socket.user = userInfo || {
            id: userId,
            name: `User ${userId}`,
            email: null,
            avatar_url: null,
          }
          userProfiles.set(userId, socket.user)
        }
      } else {
        socket.user = userProfiles.get(userId)
      }

      if (userInfo) {
        const enhancedProfile = {
          ...socket.user,
          ...userInfo,
        }
        socket.user = enhancedProfile
        userProfiles.set(userId, enhancedProfile)
      }

      // ✅ ENHANCED: Deliver offline notifications from database with better error handling
      try {
        const offlineNotificationsResult = await pool.query(
          `SELECT id, notification_type, notification_data, created_at 
         FROM offline_notifications 
         WHERE user_id = $1 AND delivered = false 
         AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at ASC`,
          [userId],
        )

        if (offlineNotificationsResult.rows.length > 0) {
          console.log(`📬 Delivering ${offlineNotificationsResult.rows.length} offline notifications to user ${userId}`)

          for (const notification of offlineNotificationsResult.rows) {
            const notificationData = notification.notification_data

            // ✅ ENHANCED: Send different events based on notification type
            if (notification.notification_type === "connection_request") {
              socket.emit("connection-requested", {
                fromUserId: notificationData.fromUserId,
                fromUserName: notificationData.fromUserName,
                fromUserAvatar: notificationData.fromUserAvatar,
                toUserId: notificationData.toUserId,
                roomId: notificationData.roomId,
                tripId: notificationData.tripId,
                message: notificationData.message,
                timestamp: notificationData.timestamp || notification.created_at,
                isOfflineDelivery: true,
                originalTimestamp: notification.created_at,
                notificationId: notification.id,
              })
            } else {
              // Handle other notification types
              socket.emit(notification.notification_type, {
                ...notificationData,
                isOfflineDelivery: true,
                originalTimestamp: notification.created_at,
                notificationId: notification.id,
              })
            }

            console.log(`📬 Delivered offline notification to user ${userId}:`, notificationData)
          }

          // ✅ ENHANCED: Mark as delivered after successful sending
          const notificationIds = offlineNotificationsResult.rows.map((n) => n.id)
          await pool.query(
            `UPDATE offline_notifications 
           SET delivered = true, delivered_at = NOW() 
           WHERE id = ANY($1)`,
            [notificationIds],
          )

          console.log(`✅ All offline notifications delivered and marked as delivered for user ${userId}`)
        } else {
          console.log(`📭 No offline notifications found for user ${userId}`)
        }
      } catch (dbError) {
        console.error("❌ Error delivering offline notifications:", dbError)
      }

      // Confirm registration
      socket.emit("user-registered", {
        success: true,
        userId: userId,
        socketId: socket.id,
        message: "Successfully registered",
        offlineNotificationsDelivered: true,
      })
    } catch (error) {
      console.error("❌ Error registering user:", error)
      socket.emit("user-registered", {
        success: false,
        error: error.message,
      })
    }
  })

  // Join room
  socket.on("join_room", async ({ roomId, otherUserId, userId }) => {
    try {
      console.log(`📡 User ${userId} joining room: ${roomId} with user: ${otherUserId}`)

      if (!socket.userId) {
        socket.userId = Number.parseInt(userId)
        activeUsers.set(socket.userId, socket.id)

        try {
          const userResult = await pool.query(`SELECT id, name, email, avatar_url FROM users WHERE id = $1`, [
            socket.userId,
          ])
          if (userResult.rows.length > 0) {
            const userProfile = userResult.rows[0]
            socket.user = userProfile
            userProfiles.set(socket.userId, userProfile)
            console.log(`👤 User profile loaded: ${userProfile.name} (${userProfile.id})`)
          }
        } catch (dbError) {
          console.warn("⚠️ Could not load user profile from database:", dbError.message)
          socket.user = {
            id: socket.userId,
            name: `User ${socket.userId}`,
            email: null,
            avatar_url: null,
          }
          userProfiles.set(socket.userId, socket.user)
        }
      }

      socket.join(roomId)

      if (!userRooms.has(socket.userId)) {
        userRooms.set(socket.userId, new Set())
      }
      userRooms.get(socket.userId).add(roomId)

      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Set())
      }
      roomUsers.get(roomId).add(socket.userId)

      try {
        await pool.query(
          `INSERT INTO chat_rooms (id, room_name, room_type, created_at, updated_at) 
           VALUES ($1, $2, 'direct', NOW(), NOW()) 
           ON CONFLICT (id) DO NOTHING`,
          [roomId, `Chat ${roomId}`],
        )
        console.log(`✅ Chat room ${roomId} ensured in database`)
      } catch (dbError) {
        console.warn("⚠️ Could not ensure chat room in database:", dbError.message)
      }

      try {
        const messagesResult = await pool.query(
          `
          SELECT 
            cm.id,
            cm.message_text as message,
            cm.message_type,
            cm.created_at,
            cm.sender_id,
            u.name as sender_name,
            u.avatar_url as sender_avatar
          FROM chat_messages cm
          JOIN users u ON cm.sender_id = u.id
          WHERE cm.room_id = $1
          ORDER BY cm.created_at ASC
          LIMIT 50
        `,
          [roomId],
        )

        socket.emit("chat_history", {
          roomId,
          messages: messagesResult.rows,
        })

        console.log(`📜 Sent ${messagesResult.rows.length} historical messages to user ${socket.userId}`)
      } catch (dbError) {
        console.warn("⚠️ Could not load chat history:", dbError.message)
      }

      socket.to(roomId).emit("user_joined", {
        userId: socket.userId,
        userName: socket.user.name,
        roomId,
        socketId: socket.id,
      })

      console.log(`✅ User ${socket.userId} (${socket.user.name}) joined room: ${roomId}`)
      socket.emit("room_joined", { roomId, success: true })
    } catch (error) {
      console.error("❌ Error joining room:", error)
      socket.emit("error", { message: "Failed to join room" })
    }
  })

  // Leave room
  socket.on("leave_room", ({ roomId, userId }) => {
    try {
      const userIdToUse = userId || socket.userId
      console.log(`📡 User ${userIdToUse} leaving room: ${roomId}`)

      socket.leave(roomId)

      if (userRooms.has(userIdToUse)) {
        userRooms.get(userIdToUse).delete(roomId)
      }
      if (roomUsers.has(roomId)) {
        roomUsers.get(roomId).delete(userIdToUse)
      }

      socket.to(roomId).emit("user_left", {
        userId: userIdToUse,
        roomId,
      })

      console.log(`✅ User ${userIdToUse} left room: ${roomId}`)
    } catch (error) {
      console.error("❌ Error leaving room:", error)
    }
  })

  // Send message
  socket.on("send_message", async ({ roomId, message, otherUserId, senderId }, callback) => {
    try {
      const userIdToUse = senderId || socket.userId
      console.log(`💬 Message from ${userIdToUse} in room ${roomId}: "${message}"`)

      let senderName = "Unknown User"
      let senderAvatar = null

      if (socket.user && socket.user.name) {
        senderName = socket.user.name
        senderAvatar = socket.user.avatar_url
      } else if (userProfiles.has(userIdToUse)) {
        const profile = userProfiles.get(userIdToUse)
        senderName = profile.name || `User ${userIdToUse}`
        senderAvatar = profile.avatar_url
      } else {
        try {
          const userResult = await pool.query(`SELECT name, avatar_url FROM users WHERE id = $1`, [userIdToUse])
          if (userResult.rows.length > 0) {
            senderName = userResult.rows[0].name || `User ${userIdToUse}`
            senderAvatar = userResult.rows[0].avatar_url

            const userProfile = {
              id: userIdToUse,
              name: senderName,
              avatar_url: senderAvatar,
            }
            userProfiles.set(userIdToUse, userProfile)
            if (socket.userId === userIdToUse) {
              socket.user = userProfile
            }
          }
        } catch (dbError) {
          console.warn("⚠️ Could not fetch user from database:", dbError.message)
          senderName = `User ${userIdToUse}`
        }
      }

      let savedMessage = null
      try {
        await pool.query(
          `INSERT INTO chat_rooms (id, room_name, room_type, created_at, updated_at) 
           VALUES ($1, $2, 'direct', NOW(), NOW()) 
           ON CONFLICT (id) DO NOTHING`,
          [roomId, `Chat ${roomId}`],
        )

        const insertResult = await pool.query(
          `INSERT INTO chat_messages (room_id, sender_id, message_text, message_type, created_at)
           VALUES ($1, $2, $3, 'text', CURRENT_TIMESTAMP)
           RETURNING id, created_at`,
          [roomId, userIdToUse, message.trim()],
        )

        savedMessage = insertResult.rows[0]
        console.log(`💾 Message saved to database with ID: ${savedMessage.id}`)
      } catch (dbError) {
        console.error("❌ Failed to save message to database:", dbError)
      }

      const messageData = {
        id: savedMessage?.id || Date.now() + Math.random(),
        message: message.trim(),
        sender_id: userIdToUse,
        sender_name: senderName,
        sender_avatar: senderAvatar,
        room_id: roomId,
        created_at: savedMessage?.created_at || new Date().toISOString(),
        timestamp: savedMessage?.created_at ? new Date(savedMessage.created_at).getTime() : Date.now(),
        message_type: "text",
      }

      console.log(`📤 Broadcasting message from ${senderName} (${userIdToUse}) to room ${roomId}`)

      io.to(roomId).emit("new_message", messageData)

      const roomUserIds = Array.from(roomUsers.get(roomId) || [])
      roomUserIds.forEach((userId) => {
        if (userId !== userIdToUse) {
          const targetSocketId = activeUsers.get(userId)
          if (targetSocketId) {
            io.to(targetSocketId).emit("chat-message-notification", {
              roomId,
              senderId: userIdToUse,
              senderName,
              senderAvatar,
              message: message.trim(),
              timestamp: messageData.created_at,
              otherUserId: userIdToUse,
            })
            console.log(`📬 Notification sent to user ${userId} about message from ${userIdToUse}`)
          }

          io.to(`user_${userId}`).emit("chat-message-notification", {
            roomId,
            senderId: userIdToUse,
            senderName,
            senderAvatar,
            message: message.trim(),
            timestamp: messageData.created_at,
            otherUserId: userIdToUse,
          })
        }
      })

      if (callback) {
        callback({
          success: true,
          messageId: messageData.id,
          timestamp: messageData.timestamp,
          senderName: senderName,
          saved: !!savedMessage,
          messageData: messageData,
        })
      }

      console.log(`✅ Message sent successfully in room ${roomId} ${savedMessage ? "(saved to DB)" : "(not saved)"}`)
    } catch (error) {
      console.error("❌ Error sending message:", error)
      if (callback) {
        callback({
          success: false,
          error: error.message,
        })
      }
    }
  })

  // Get chat history
  socket.on("get_chat_history", async ({ roomId, userId, limit = 50 }) => {
    try {
      console.log(`📜 Chat history requested for room ${roomId} by user ${userId}`)

      const messagesResult = await pool.query(
        `
        SELECT 
          cm.id,
          cm.message_text as message,
          cm.message_type,
          cm.created_at,
          cm.sender_id,
          u.name as sender_name,
          u.avatar_url as sender_avatar
        FROM chat_messages cm
        JOIN users u ON cm.sender_id = u.id
        WHERE cm.room_id = $1
        ORDER BY cm.created_at ASC
        LIMIT $2
      `,
        [roomId, limit],
      )

      socket.emit("chat_history", {
        roomId,
        messages: messagesResult.rows,
        success: true,
      })

      console.log(`📜 Sent ${messagesResult.rows.length} messages to user ${userId} for room ${roomId}`)
    } catch (error) {
      console.error("❌ Error fetching chat history:", error)
      socket.emit("chat_history", {
        roomId,
        messages: [],
        success: false,
        error: error.message,
      })
    }
  })

  // ✅ COMPLETELY FIXED: Send connection request with duplicate prevention and offline storage
  socket.on("send-connection-request", async (data) => {
    try {
      const { fromUserId, toUserId, fromUserName, fromUserAvatar, roomId, tripId, message } = data

      const fromUserIdInt = Number.parseInt(fromUserId)
      const toUserIdInt = Number.parseInt(toUserId)

      console.log("🔔 [SEND-CONNECTION-REQUEST] Received:", {
        fromUserId: fromUserIdInt,
        toUserId: toUserIdInt,
        roomId,
      })

      // ✅ STEP 1: Check for duplicate requests in database
      try {
        const existingAttempt = await pool.query(
          `SELECT id, status, created_at FROM connection_request_attempts 
           WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'
           AND created_at > NOW() - INTERVAL '5 minutes'`,
          [fromUserIdInt, toUserIdInt],
        )

        if (existingAttempt.rows.length > 0) {
          console.log("🚫 Duplicate connection request blocked (database check)")
          socket.emit("connection-request-sent", {
            success: false,
            message: "Connection request already sent recently",
            duplicate: true,
          })
          return
        }
      } catch (dbError) {
        console.warn("⚠️ Could not check for duplicate requests:", dbError.message)
      }

      // ✅ STEP 2: Check in-memory cache for very recent requests
      const requestKey = `${fromUserIdInt}_${toUserIdInt}`
      const now = Date.now()
      const lastRequestTime = recentConnectionRequests.get(requestKey)

      if (lastRequestTime && now - lastRequestTime < 10000) {
        // 10 seconds cooldown
        console.log("🚫 Duplicate connection request blocked (memory check)")
        socket.emit("connection-request-sent", {
          success: false,
          message: "Please wait before sending another request",
          duplicate: true,
        })
        return
      }

      // ✅ STEP 3: Record this request attempt
      recentConnectionRequests.set(requestKey, now)

      // Clean up old entries from memory
      setTimeout(() => {
        recentConnectionRequests.delete(requestKey)
      }, 30000) // 30 seconds

      // ✅ STEP 4: Record in database
      try {
        await pool.query(
          `INSERT INTO connection_request_attempts (from_user_id, to_user_id, room_id, status, created_at)
           VALUES ($1, $2, $3, 'pending', NOW())
           ON CONFLICT (from_user_id, to_user_id, room_id) 
           DO UPDATE SET created_at = NOW(), status = 'pending'`,
          [fromUserIdInt, toUserIdInt, roomId],
        )
      } catch (dbError) {
        console.warn("⚠️ Could not record connection attempt:", dbError.message)
      }

      // ✅ STEP 5: Get enhanced sender info
      const senderProfile = userProfiles.get(fromUserIdInt) || socket.user
      const senderData = {
        id: fromUserIdInt,
        name: fromUserName || senderProfile?.name || `User ${fromUserIdInt}`,
        avatar_url: fromUserAvatar || senderProfile?.avatar_url,
      }

      const requestData = {
        fromUserId: fromUserIdInt,
        fromUserName: senderData.name,
        fromUserAvatar: senderData.avatar_url,
        toUserId: toUserIdInt,
        roomId,
        tripId,
        message: message || `${senderData.name} wants to connect with you`,
        timestamp: new Date().toISOString(),
      }

      // ✅ STEP 6: Try to deliver immediately if user is online
      const targetSocketId = activeUsers.get(toUserIdInt)
      let delivered = false

      if (targetSocketId) {
        console.log(`📡 Found target user ${toUserIdInt} online with socket ${targetSocketId}`)

        // Send to specific socket
        io.to(targetSocketId).emit("connection-requested", requestData)
        delivered = true
        console.log(`✅ Connection request sent via direct socket to user ${toUserIdInt}`)
      }

      // ✅ STEP 7: Also try user room broadcast (backup)
      const userRoomKey = `user_${toUserIdInt}`
      io.to(userRoomKey).emit("connection-requested", requestData)
      console.log(`📡 Connection request sent via user room ${userRoomKey}`)

      // ✅ STEP 8: Check all connected sockets (last resort)
      const allSockets = await io.fetchSockets()
      for (const sock of allSockets) {
        if (sock.userId === toUserIdInt) {
          sock.emit("connection-requested", requestData)
          delivered = true
          console.log(`📡 Connection request sent via socket scan to user ${toUserIdInt}`)
          break
        }
      }

      // ✅ STEP 9: If user is offline, store in database for later delivery
      if (!delivered) {
        try {
          // ✅ FIXED: Store with proper expiration
          await pool.query(
            `INSERT INTO offline_notifications (user_id, notification_type, notification_data, created_at)
             VALUES ($1, 'connection_request', $2, NOW())`,
            [toUserIdInt, JSON.stringify(requestData)],
          )

          console.log(`📦 Connection request stored for offline user ${toUserIdInt}`)

          // ✅ FIXED: Set expiration for pending request
          await pool.query(
            `UPDATE connection_request_attempts 
             SET expires_at = NOW() + INTERVAL '10 minutes'
             WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
            [fromUserIdInt, toUserIdInt],
          )

          socket.emit("connection-request-sent", {
            success: true,
            toUserId: toUserIdInt,
            roomId,
            message: "Connection request sent (user offline, will be delivered when online)",
            offline: true,
            expiresIn: "10 minutes",
          })
        } catch (dbError) {
          console.error("❌ Failed to store offline notification:", dbError)
          socket.emit("connection-request-sent", {
            success: false,
            message: "Failed to send connection request",
            error: dbError.message,
          })
        }
      } else {
        // ✅ FIXED: Set expiration for online delivery too
        try {
          await pool.query(
            `UPDATE connection_request_attempts 
             SET expires_at = NOW() + INTERVAL '10 minutes'
             WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
            [fromUserIdInt, toUserIdInt],
          )
        } catch (dbError) {
          console.warn("⚠️ Could not set expiration for connection attempt:", dbError.message)
        }

        socket.emit("connection-request-sent", {
          success: true,
          toUserId: toUserIdInt,
          roomId,
          message: "Connection request sent successfully",
          offline: false,
          expiresIn: "10 minutes",
        })
      }

      console.log(`✅ Connection request processing completed for user ${toUserIdInt}`)
    } catch (error) {
      console.error("❌ Error sending connection request:", error)
      socket.emit("connection-request-failed", {
        success: false,
        error: error.message,
      })
    }
  })

  // ✅ FIXED: Accept connection request
  socket.on("accept-connection-request", async (data) => {
    try {
      console.log("✅ [ACCEPT-CONNECTION] Received:", data)
      const { fromUserId, toUserId, roomId } = data

      const requesterUserId = Number.parseInt(fromUserId)
      const accepterUserId = Number.parseInt(toUserId)

      // ✅ Update connection attempt status
      try {
        await pool.query(
          `UPDATE connection_request_attempts 
           SET status = 'accepted' 
           WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
          [requesterUserId, accepterUserId],
        )
      } catch (dbError) {
        console.warn("⚠️ Could not update connection attempt status:", dbError.message)
      }

      // DB UPDATE: Set both users as connected in DB
      try {
        await pool.query(
          `INSERT INTO chat_rooms (id, room_name, room_type, created_at, updated_at) 
           VALUES ($1, $2, 'direct', NOW(), NOW()) 
           ON CONFLICT (id) DO NOTHING`,
          [roomId, `Chat ${roomId}`],
        )

        await pool.query(
          `INSERT INTO user_connections (user1_id, user2_id, status, room_id, created_at, updated_at)
           VALUES ($1, $2, 'connected', $3, NOW(), NOW())
           ON CONFLICT (user1_id, user2_id) 
           DO UPDATE SET status = 'connected', room_id = $3, updated_at = NOW()`,
          [Math.min(fromUserId, toUserId), Math.max(fromUserId, toUserId), roomId],
        )

        await pool.query(
          `INSERT INTO chat_participants (room_id, user_id, status, joined_at)
           VALUES ($1, $2, 'connected', NOW()), ($1, $3, 'connected', NOW())
           ON CONFLICT (room_id, user_id) 
           DO UPDATE SET status = 'connected', joined_at = NOW()`,
          [roomId, fromUserId, toUserId],
        )

        console.log(`✅ DB: Connection status updated to 'connected' for users ${fromUserId} & ${toUserId}`)
      } catch (dbError) {
        console.error("❌ DB error updating connection status:", dbError)
      }

      // Get both users' info
      const accepterProfile = userProfiles.get(accepterUserId) || socket.user
      const requesterProfile = userProfiles.get(requesterUserId)

      const accepterData = {
        id: accepterUserId,
        name: accepterProfile?.name || `User ${accepterUserId}`,
        avatar_url: accepterProfile?.avatar_url,
      }

      // Find requester's socket and update THEIR state
      const requesterSocketId = activeUsers.get(requesterUserId)

      if (requesterSocketId) {
        io.to(requesterSocketId).emit("connection-accepted", {
          fromUserId: accepterUserId,
          fromUserName: accepterData.name,
          fromUserAvatar: accepterData.avatar_url,
          toUserId: requesterUserId,
          roomId,
          timestamp: new Date().toISOString(),
          updateTargetUserId: accepterUserId,
        })

        console.log(`✅ REQUESTER ${requesterUserId} notified that ${accepterUserId} accepted their request`)
      }

      io.to(`user_${requesterUserId}`).emit("connection-accepted", {
        fromUserId: accepterUserId,
        fromUserName: accepterData.name,
        fromUserAvatar: accepterData.avatar_url,
        toUserId: requesterUserId,
        roomId,
        timestamp: new Date().toISOString(),
        updateTargetUserId: accepterUserId,
      })

      socket.emit("connection-ready", {
        roomId,
        otherUserId: fromUserId,
        status: "connected",
        updateTargetUserId: fromUserId,
      })

      console.log(`✅ Connection established between users ${fromUserId} and ${toUserId}`)
    } catch (error) {
      console.error("❌ Error accepting connection:", error)
    }
  })

  // ✅ ENHANCED: Reject connection request
  socket.on("reject-connection-request", async (data) => {
    try {
      console.log("❌ [REJECT-CONNECTION] Received:", data)
      const { fromUserId, toUserId, roomId } = data

      const requesterUserId = Number.parseInt(fromUserId)

      // ✅ Update connection attempt status
      try {
        await pool.query(
          `UPDATE connection_request_attempts 
           SET status = 'rejected' 
           WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
          [requesterUserId, Number.parseInt(toUserId)],
        )
      } catch (dbError) {
        console.warn("⚠️ Could not update connection attempt status:", dbError.message)
      }

      // Get rejecter's info
      const rejecterProfile = userProfiles.get(toUserId) || socket.user
      const rejecterData = {
        id: toUserId,
        name: rejecterProfile?.name || `User ${toUserId}`,
        avatar_url: rejecterProfile?.avatar_url,
      }

      // Find requester's socket
      const requesterSocketId = activeUsers.get(requesterUserId)

      if (requesterSocketId) {
        io.to(requesterSocketId).emit("connection-rejected", {
          fromUserId: toUserId,
          fromUserName: rejecterData.name,
          fromUserAvatar: rejecterData.avatar_url,
          toUserId: requesterUserId,
          roomId,
          timestamp: new Date().toISOString(),
        })
        console.log(`❌ Connection rejection sent to user ${fromUserId}`)
      } else {
        io.to(`user_${requesterUserId}`).emit("connection-rejected", {
          fromUserId: toUserId,
          fromUserName: rejecterData.name,
          fromUserAvatar: rejecterData.avatar_url,
          toUserId: requesterUserId,
          roomId,
          timestamp: new Date().toISOString(),
        })
        console.log(`📡 Connection rejection sent via user room to ${requesterUserId}`)
      }
    } catch (error) {
      console.error("❌ Error rejecting connection:", error)
    }
  })

  // ✅ FIXED: Disconnect user - properly disconnect both users
  socket.on("disconnect-user", async (data) => {
    try {
      console.log("🔌 User disconnect request:", data)
      const { fromUserId, toUserId } = data

      const fromUserIdInt = Number.parseInt(fromUserId)
      const toUserIdInt = Number.parseInt(toUserId)

      // ✅ STEP 1: Remove connection from database
      try {
        await pool.query(
          `DELETE FROM user_connections 
           WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
          [fromUserIdInt, toUserIdInt],
        )
        console.log(`✅ DB: Connection removed for users ${fromUserIdInt} & ${toUserIdInt}`)
      } catch (dbError) {
        console.error("❌ DB error removing connection:", dbError)
      }

      // ✅ STEP 2: Get disconnector's profile info
      const disconnectorProfile = userProfiles.get(fromUserIdInt) || socket.user
      const disconnectorData = {
        id: fromUserIdInt,
        name: disconnectorProfile?.name || `User ${fromUserIdInt}`,
        avatar_url: disconnectorProfile?.avatar_url,
      }

      // ✅ STEP 3: Notify the target user (toUserId) about disconnection
      const targetSocketId = activeUsers.get(toUserIdInt)
      if (targetSocketId) {
        io.to(targetSocketId).emit("connection-disconnected", {
          fromUserId: fromUserIdInt,
          fromUserName: disconnectorData.name,
          fromUserAvatar: disconnectorData.avatar_url,
          timestamp: new Date().toISOString(),
        })

        io.to(targetSocketId).emit("connection-status-updated", {
          userId: fromUserIdInt,
          newStatus: "none",
          roomId: null,
          timestamp: new Date().toISOString(),
        })

        console.log(`🔌 Disconnect notification sent to user ${toUserIdInt}`)
      }

      // ✅ STEP 4: Also send via user room (backup)
      io.to(`user_${toUserIdInt}`).emit("connection-disconnected", {
        fromUserId: fromUserIdInt,
        fromUserName: disconnectorData.name,
        fromUserAvatar: disconnectorData.avatar_url,
        timestamp: new Date().toISOString(),
      })

      // ✅ STEP 5: Notify the disconnector (fromUserId) that disconnection was successful
      socket.emit("disconnection-confirmed", {
        targetUserId: toUserIdInt,
        status: "disconnected",
        timestamp: new Date().toISOString(),
      })

      console.log(`✅ Both users ${fromUserIdInt} and ${toUserIdInt} have been disconnected`)
    } catch (error) {
      console.error("❌ Error disconnecting user:", error)
      socket.emit("disconnection-failed", {
        error: error.message,
        targetUserId: data.toUserId,
      })
    }
  })

  // Update connection status
  socket.on("update-connection-status", async (data) => {
    try {
      const { targetUserId, newStatus, roomId, fromUserId } = data
      console.log(`🔄 Updating connection status: ${targetUserId} -> ${newStatus}`)

      const targetSocketId = activeUsers.get(Number.parseInt(targetUserId))
      if (targetSocketId) {
        io.to(targetSocketId).emit("connection-status-updated", {
          userId: fromUserId || socket.userId,
          newStatus,
          roomId,
          timestamp: new Date().toISOString(),
        })
        console.log(`✅ Status update sent to user ${targetUserId}`)
      }
    } catch (error) {
      console.error("❌ Error updating connection status:", error)
    }
  })

  // Debug active users
  socket.on("debug-active-users", () => {
    console.log("🔍 [DEBUG] Active users:", Array.from(activeUsers.entries()))
    socket.emit("debug-response", {
      activeUsers: Array.from(activeUsers.entries()),
      totalUsers: activeUsers.size,
      yourUserId: socket.userId,
      yourSocketId: socket.id,
      userProfiles: Array.from(userProfiles.entries()),
    })
  })

  // Typing indicators
  socket.on("start_typing", ({ roomId, otherUserId, userId }) => {
    const userIdToUse = userId || socket.userId
    const userName = socket.user?.name || `User ${userIdToUse}`

    socket.to(roomId).emit("user_typing", {
      userId: userIdToUse,
      userName: userName,
      roomId,
    })
  })

  socket.on("stop_typing", ({ roomId, otherUserId, userId }) => {
    const userIdToUse = userId || socket.userId

    socket.to(roomId).emit("user_stopped_typing", {
      userId: userIdToUse,
      roomId,
    })
  })

  // Authentication
  socket.on("authenticate", async (data) => {
    try {
      const { token, userId } = data

      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        socket.user = decoded
      }

      socket.userId = Number.parseInt(userId)
      activeUsers.set(socket.userId, socket.id)

      try {
        const userResult = await pool.query(`SELECT id, name, email, avatar_url FROM users WHERE id = $1`, [
          socket.userId,
        ])
        if (userResult.rows.length > 0) {
          socket.user = userResult.rows[0]
          userProfiles.set(socket.userId, socket.user)
        }
      } catch (dbError) {
        console.warn("⚠️ Could not load user profile:", dbError.message)
      }

      console.log(`✅ User ${socket.userId} authenticated`)
      socket.emit("authenticated", { success: true })
    } catch (error) {
      console.error("❌ Authentication failed:", error.message)
      socket.emit("authenticated", { success: false, error: error.message })
    }
  })

  // ✅ NEW: Handle message deletion
  socket.on("delete_message", async (data) => {
    try {
      console.log("🗑️ Socket: Delete message request:", data)

      const { messageId, roomId, userId } = data

      if (!messageId || !roomId || !userId) {
        console.error("❌ Missing required fields for message deletion")
        return
      }

      // Emit to all users in the room that a message was deleted
      socket.to(roomId).emit("message_deleted", {
        messageId: messageId,
        roomId: roomId,
        deletedBy: userId,
        timestamp: new Date().toISOString(),
      })

      console.log(`✅ Message deletion event broadcasted for message ${messageId}`)
    } catch (error) {
      console.error("❌ Error handling delete message:", error)
    }
  })

  // ✅ NEW: Handle bulk message deletion
  socket.on("bulk_delete_messages", async (data) => {
    try {
      console.log("🗑️ Socket: Bulk delete messages request:", data)

      const { messageIds, roomId, userId } = data

      if (!messageIds || !Array.isArray(messageIds) || !roomId || !userId) {
        console.error("❌ Missing required fields for bulk message deletion")
        return
      }

      // Emit to all users in the room that messages were deleted
      socket.to(roomId).emit("bulk_messages_deleted", {
        messageIds: messageIds,
        roomId: roomId,
        deletedBy: userId,
        timestamp: new Date().toISOString(),
      })

      console.log(`✅ Bulk message deletion event broadcasted for ${messageIds.length} messages`)
    } catch (error) {
      console.error("❌ Error handling bulk delete messages:", error)
    }
  })

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    console.log(`❌ User ${socket.userId} disconnected (${reason})`)

    if (socket.userId) {
      activeUsers.delete(socket.userId)
      userProfiles.delete(socket.userId)

      if (userRooms.has(socket.userId)) {
        const rooms = userRooms.get(socket.userId)
        rooms.forEach((roomId) => {
          socket.to(roomId).emit("user_left", {
            userId: socket.userId,
            roomId,
          })

          if (roomUsers.has(roomId)) {
            roomUsers.get(roomId).delete(socket.userId)
          }
        })
        userRooms.delete(socket.userId)
      }

      socket.broadcast.emit("user_offline", {
        userId: socket.userId,
      })
    }
  })

  // Error handling
  socket.on("error", (error) => {
    console.error(`❌ Socket error for user ${socket.userId}:`, error)
  })
}

export { activeUsers, userRooms, roomUsers, userProfiles }
