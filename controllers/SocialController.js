import pool from "../config/database.js"

// Helper function to calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371 // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// ✅ ENHANCED: Check connection status with pending timeout and expiration
const getSimpleConnectionStatus = async (currentUserId, targetUserId) => {
  try {
    const currentUserIdInt = Number.parseInt(currentUserId)
    const targetUserIdInt = Number.parseInt(targetUserId)

    if (isNaN(currentUserIdInt) || isNaN(targetUserIdInt)) {
      console.error("Invalid user IDs:", { currentUserId, targetUserId })
      return { status: "none", room_id: null }
    }

    // ✅ FIRST: Expire old pending requests
    try {
      await pool.query(`SELECT expire_pending_requests()`)
    } catch (expireError) {
      console.warn("Could not expire old requests:", expireError.message)
    }

    // 1. Check in the user_connections table (preferred)
    const connResult = await pool.query(
      `SELECT status, room_id FROM user_connections
       WHERE (user1_id = $1 AND user2_id = $2)
          OR (user1_id = $2 AND user2_id = $1)
       LIMIT 1`,
      [currentUserIdInt, targetUserIdInt],
    )
    if (connResult.rows.length > 0) {
      const conn = connResult.rows[0]
      if (conn.status === "connected") {
        return { status: "connected", room_id: conn.room_id }
      }
    }

    // ✅ 2. Check for active (non-expired) pending requests
    const pendingResult = await pool.query(
      `SELECT room_id, expires_at, status FROM connection_request_attempts
       WHERE from_user_id = $1 AND to_user_id = $2 
       AND status = 'pending' 
       AND expires_at > NOW()
       LIMIT 1`,
      [currentUserIdInt, targetUserIdInt],
    )
    if (pendingResult.rows.length > 0) {
      return {
        status: "pending",
        room_id: pendingResult.rows[0].room_id,
        expires_at: pendingResult.rows[0].expires_at,
      }
    }

    // ✅ 3. Check for expired requests (allow resend)
    const expiredResult = await pool.query(
      `SELECT room_id FROM connection_request_attempts
       WHERE from_user_id = $1 AND to_user_id = $2 
       AND (status = 'expired' OR expires_at <= NOW())
       LIMIT 1`,
      [currentUserIdInt, targetUserIdInt],
    )
    if (expiredResult.rows.length > 0) {
      // Clean up expired request
      await pool.query(
        `UPDATE connection_request_attempts 
         SET status = 'expired' 
         WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
        [currentUserIdInt, targetUserIdInt],
      )
      return { status: "expired", room_id: null, canResend: true }
    }

    // 4. Fallback: Check in chat_rooms (legacy support)
    const connectionQuery = `
      SELECT 
        cr.id as room_id,
        cp1.status as user1_status,
        cp2.status as user2_status
      FROM chat_rooms cr
      JOIN chat_participants cp1 ON cr.id = cp1.room_id AND cp1.user_id = $1
      JOIN chat_participants cp2 ON cr.id = cp2.room_id AND cp2.user_id = $2
      WHERE cr.room_type = 'direct'
      LIMIT 1
    `
    const connectionResult = await pool.query(connectionQuery, [currentUserIdInt, targetUserIdInt])
    if (connectionResult.rows.length > 0) {
      const conn = connectionResult.rows[0]
      if (conn.user1_status === "accepted" && conn.user2_status === "accepted") {
        return { status: "connected", room_id: conn.room_id }
      }
    }

    return { status: "none", room_id: null, canResend: true }
  } catch (error) {
    console.error("Error checking connection status:", error)
    return { status: "none", room_id: null, canResend: true }
  }
}

// ✅ NEW: Get connected user's location and details
export const getConnectedUserLocation = async (req, res) => {
  try {
    console.log("📍 === GET CONNECTED USER LOCATION ===")

    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    const { targetUserId } = req.params

    if (!userId || !targetUserId) {
      return res.status(400).json({
        success: false,
        message: "User ID and target user ID are required",
      })
    }

    const userIdInt = Number.parseInt(String(userId))
    const targetUserIdInt = Number.parseInt(String(targetUserId))

    if (isNaN(userIdInt) || isNaN(targetUserIdInt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      })
    }

    console.log(`📍 Checking location access for user ${userIdInt} -> user ${targetUserIdInt}`)

    // ✅ FIRST: Verify users are connected
    const connectionInfo = await getSimpleConnectionStatus(userIdInt, targetUserIdInt)

    if (connectionInfo.status !== "connected") {
      return res.status(403).json({
        success: false,
        message: "You must be connected to this user to view their location",
        connectionStatus: connectionInfo.status,
      })
    }

    // ✅ Get current user's location for distance calculation
    const currentUserLocationQuery = `
      SELECT latitude, longitude, location_city, location_updated_at
      FROM user_profiles 
      WHERE user_id = $1
    `
    const currentUserResult = await pool.query(currentUserLocationQuery, [userIdInt])

    // ✅ Get target user's location and profile info with enhanced address data
    const targetUserQuery = `
      SELECT 
        u.id,
        u.name,
        u.email,
        u.avatar_url,
        up.latitude,
        up.longitude,
        up.location_city,
        up.location_state,
        up.location_country,
        up.formatted_address,
        up.current_location,
        up.location_updated_at,
        up.is_discoverable,
        up.status,
        up.last_active
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE u.id = $1
    `
    const targetUserResult = await pool.query(targetUserQuery, [targetUserIdInt])

    if (targetUserResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Target user not found",
      })
    }

    const targetUser = targetUserResult.rows[0]

    // ✅ Check if target user allows location sharing
    if (!targetUser.is_discoverable) {
      return res.json({
        success: true,
        locationShared: false,
        message: "User has disabled location sharing",
        user: {
          id: targetUser.id,
          name: targetUser.name,
          avatar_url: targetUser.avatar_url,
          status: targetUser.status,
          last_active: targetUser.last_active,
        },
      })
    }

    // ✅ Calculate distance if both users have location
    let distance = null
    let distanceText = null

    if (
      currentUserResult.rows.length > 0 &&
      currentUserResult.rows[0].latitude &&
      currentUserResult.rows[0].longitude &&
      targetUser.latitude &&
      targetUser.longitude
    ) {
      const currentUserLoc = currentUserResult.rows[0]
      distance = calculateDistance(
        currentUserLoc.latitude,
        currentUserLoc.longitude,
        targetUser.latitude,
        targetUser.longitude,
      )

      if (distance < 1) {
        distanceText = `${Math.round(distance * 1000)}m away`
      } else if (distance < 100) {
        distanceText = `${distance.toFixed(1)}km away`
      } else {
        distanceText = `${Math.round(distance)}km away`
      }
    }

    // ✅ Return enhanced location data with formatted address
    res.json({
      success: true,
      locationShared: true,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        avatar_url: targetUser.avatar_url,
        status: targetUser.status,
        last_active: targetUser.last_active,
      },
      location: {
        latitude: targetUser.latitude,
        longitude: targetUser.longitude,
        city: targetUser.location_city,
        state: targetUser.location_state,
        country: targetUser.location_country,
        formatted_address: targetUser.formatted_address || `${targetUser.latitude}, ${targetUser.longitude}`,
        current_location: targetUser.formatted_address || targetUser.current_location,
        updated_at: targetUser.location_updated_at,
        distance: distance,
        distanceText: distanceText,
      },
      connectionInfo: {
        status: connectionInfo.status,
        roomId: connectionInfo.room_id,
      },
    })
  } catch (error) {
    console.error("💥 Error fetching connected user location:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch user location",
      error: error.message,
    })
  }
}

// ✅ ENHANCED: Get user notifications with better offline storage support
export const getUserNotifications = async (req, res) => {
  try {
    console.log("🔔 === GET USER NOTIFICATIONS (ENHANCED) ===")

    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing",
      })
    }

    const userIdInt = Number.parseInt(String(userId))
    if (isNaN(userIdInt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      })
    }

    console.log(`🔔 Fetching notifications for user ${userIdInt}`)

    // ✅ ENHANCED: Get all undelivered offline notifications with better query and longer retention
    const notificationsQuery = `
SELECT 
offline_notifications.id,
offline_notifications.notification_type,
offline_notifications.notification_data,
offline_notifications.created_at,
offline_notifications.delivered
FROM offline_notifications
WHERE offline_notifications.user_id = $1 
AND offline_notifications.delivered = false
AND offline_notifications.created_at > NOW() - INTERVAL '30 days'
ORDER BY offline_notifications.created_at DESC
`

    const notificationsResult = await pool.query(notificationsQuery, [userIdInt])

    console.log(`✅ Found ${notificationsResult.rows.length} notifications for user ${userIdInt}`)

    // ✅ ENHANCED: Format notifications for frontend with better data structure
    const formattedNotifications = notificationsResult.rows.map((notification) => {
      const data = notification.notification_data

      // ✅ ENHANCED: Handle different notification types properly
      if (notification.notification_type === "connection_request") {
        return {
          id: notification.id,
          type: "connection-request",
          fromUserId: data.fromUserId,
          fromUserName: data.fromUserName,
          fromUserAvatar: data.fromUserAvatar,
          toUserId: data.toUserId,
          roomId: data.roomId,
          tripId: data.tripId,
          message: data.message,
          timestamp: data.timestamp || notification.created_at,
          originalTimestamp: notification.created_at,
          isOfflineDelivery: true,
          isRead: false,
        }
      }

      // ✅ Handle message notifications
      if (notification.notification_type === "message") {
        return {
          id: notification.id,
          type: "message",
          senderId: data.senderId,
          senderName: data.senderName,
          senderAvatar: data.senderAvatar,
          message: data.message,
          roomId: data.roomId,
          timestamp: data.timestamp || notification.created_at,
          originalTimestamp: notification.created_at,
          preview: data.message
            ? data.message.length > 50
              ? data.message.substring(0, 50) + "..."
              : data.message
            : "",
          isOfflineDelivery: true,
          isRead: false,
        }
      }

      // ✅ Handle other notification types
      return {
        id: notification.id,
        type: notification.notification_type,
        title: data.title || "Notification",
        message: data.message || data.content || "You have a new notification",
        ...data,
        originalTimestamp: notification.created_at,
        timestamp: data.timestamp || notification.created_at,
        isOfflineDelivery: true,
        isRead: false,
      }
    })

    // ✅ ENHANCED: Mark notifications as delivered immediately after fetching (but keep them for UI)
    if (notificationsResult.rows.length > 0) {
      const notificationIds = notificationsResult.rows.map((n) => n.id)
      await pool.query(
        `UPDATE offline_notifications 
 SET delivered = true, delivered_at = NOW() 
 WHERE id = ANY($1)`,
        [notificationIds],
      )
      console.log(`✅ Marked ${notificationIds.length} notifications as delivered`)
    }

    res.json({
      success: true,
      notifications: formattedNotifications,
      count: formattedNotifications.length,
      unreadCount: formattedNotifications.filter((n) => !n.isRead).length,
      userId: userIdInt,
    })
  } catch (error) {
    console.error("💥 Error fetching user notifications:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    })
  }
}

// ✅ ENHANCED: Clear user notifications with selective clearing
export const clearUserNotifications = async (req, res) => {
  try {
    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing",
      })
    }

    const userIdInt = Number.parseInt(String(userId))
    const { notificationIds } = req.body

    if (notificationIds && Array.isArray(notificationIds)) {
      // Clear specific notifications
      await pool.query(
        `UPDATE offline_notifications 
       SET delivered = true, delivered_at = NOW() 
       WHERE user_id = $1 AND id = ANY($2)`,
        [userIdInt, notificationIds],
      )

      res.json({
        success: true,
        message: `${notificationIds.length} notifications cleared`,
        clearedCount: notificationIds.length,
      })
    } else {
      // Clear all notifications
      const result = await pool.query(
        `UPDATE offline_notifications 
       SET delivered = true, delivered_at = NOW() 
       WHERE user_id = $1 AND delivered = false`,
        [userIdInt],
      )

      res.json({
        success: true,
        message: "All notifications cleared",
        clearedCount: result.rowCount,
      })
    }
  } catch (error) {
    console.error("Error clearing notifications:", error)
    res.status(500).json({
      success: false,
      message: "Failed to clear notifications",
      error: error.message,
    })
  }
}

// FIND MATCHES
export const findMatches = async (req, res) => {
  try {
    const currentUserId = Number.parseInt(req.user.userId)
    const { sortBy = "compatibility", limit = 20 } = req.query

    const userTripsResult = await pool.query(
      `SELECT 
        t.*,
        COALESCE(up.interests, '[]'::jsonb) as profile_interests,
        up.travel_style,
        up.budget_range
       FROM trips t
       LEFT JOIN user_profiles up ON up.user_id = t.user_id
       WHERE t.user_id = $1 
       AND t.start_date >= CURRENT_DATE - INTERVAL '30 days'`,
      [currentUserId],
    )

    if (!userTripsResult.rows.length) {
      return res.json({
        success: true,
        matches: [],
        message: "No active trips found for matching",
      })
    }

    const userTrips = userTripsResult.rows
    const allMatches = new Map()

    for (const userTrip of userTrips) {
      try {
        const matchQuery = `
          SELECT DISTINCT
            t.*,
            u.name as user_name,
            u.email as user_email,
            u.avatar_url,
            COALESCE(up.interests, '[]'::jsonb) as profile_interests,
            up.travel_style,
            up.budget_range,
            up.latitude,
            up.longitude
          FROM trips t
          JOIN users u ON t.user_id = u.id
          LEFT JOIN user_profiles up ON up.user_id = u.id
          WHERE t.is_public = true 
          AND t.user_id != $1
          AND t.start_date >= CURRENT_DATE - INTERVAL '30 days'
        `
        const matchResult = await pool.query(matchQuery, [currentUserId])

        for (const match of matchResult.rows) {
          try {
            const connectionInfo = await getSimpleConnectionStatus(currentUserId, match.user_id)
            let matchScore = 0
            const matchReasons = []

            // Destination match (30 points)
            if (
              match.destination &&
              userTrip.destination &&
              match.destination.toLowerCase() === userTrip.destination.toLowerCase()
            ) {
              matchScore += 30
              matchReasons.push("Same destination")
            }
            // Date overlap (25 points)
            if (match.start_date <= userTrip.end_date && match.end_date >= userTrip.start_date) {
              matchScore += 25
              matchReasons.push("Overlapping dates")
            }
            // Interest match
            try {
              const matchInterests = Array.isArray(match.interests) ? match.interests : []
              const userInterests = Array.isArray(userTrip.interests) ? userTrip.interests : []
              if (matchInterests.length > 0 && userInterests.length > 0) {
                const commonInterests = matchInterests.filter((interest) => userInterests.includes(interest))
                if (commonInterests.length > 0) {
                  matchScore += Math.min(25, commonInterests.length * 5)
                  matchReasons.push(`${commonInterests.length} shared interests`)
                }
              }
            } catch (interestError) {
              // ignore
            }
            // Budget compatibility (20 points)
            if (match.budget && userTrip.budget) {
              const budgetDiff = Math.abs(match.budget - userTrip.budget) / Math.max(match.budget, userTrip.budget)
              if (budgetDiff < 0.3) {
                matchScore += 20
                matchReasons.push("Similar budget")
              }
            }
            if (matchScore >= 20 && matchReasons.length > 0) {
              const matchKey = `${match.user_id}-${match.id}`
              if (!allMatches.has(matchKey) || allMatches.get(matchKey).match_score < matchScore) {
                allMatches.set(matchKey, {
                  ...match,
                  user_trip_id: userTrip.id,
                  user_trip_destination: userTrip.destination,
                  match_score: matchScore,
                  match_reasons: matchReasons,
                  connection_status: connectionInfo.status,
                  room_id: connectionInfo.room_id,
                })
              }
            }
          } catch (matchError) {
            console.error(`Error processing match for user ${match.user_id}:`, matchError)
            continue
          }
        }
      } catch (queryError) {
        console.error(`Error in match query for user trip ${userTrip.id}:`, queryError)
        continue
      }
    }

    const matches = Array.from(allMatches.values())
    switch (sortBy) {
      case "interests":
        matches.sort((a, b) => {
          const aInterests = Array.isArray(a.interests) ? a.interests.length : 0
          const bInterests = Array.isArray(b.interests) ? b.interests.length : 0
          return bInterests - aInterests
        })
        break
      case "destination":
        matches.sort((a, b) => (a.destination || "").localeCompare(b.destination || ""))
        break
      case "dates":
        matches.sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
        break
      case "compatibility":
      default:
        matches.sort((a, b) => b.match_score - a.match_score)
        break
    }

    res.json({
      success: true,
      matches: matches.slice(0, limit),
      sortedBy: sortBy,
      totalFound: matches.length,
    })
  } catch (error) {
    console.error("Error finding enhanced matches:", error)
    res.status(500).json({
      success: false,
      message: "Failed to find matches",
      error: error.message,
    })
  }
}

// ✅ ENHANCED: DISCOVER TRAVELERS - This is the main function for Public Trips
export const discoverTravelers = async (req, res) => {
  try {
    console.log("🔍 === DISCOVER TRAVELERS (PUBLIC TRIPS) ===")

    const currentUserId = Number.parseInt(req.user.userId)
    const { destination, interests, limit = 50, offset = 0, sortBy = "recent", latitude, longitude } = req.query

    console.log(`🔍 Fetching public trips for user ${currentUserId}`)
    console.log(`📊 Params:`, { destination, interests, limit, offset, sortBy, latitude, longitude })

    // ✅ ENHANCED: Build dynamic query with better filtering (removed problematic reviews join)
    let query = `
  SELECT 
    t.id,
    t.user_id,
    t.destination,
    t.start_location,
    t.days,
    t.budget,
    t.travelers,
    t.interests,
    t.start_date,
    t.end_date,
    t.created_at,
    t.is_public,
    u.name as user_name,
    u.email as user_email,
    u.avatar_url,
    up.interests as profile_interests,
    up.travel_style,
    up.budget_range,
    up.latitude,
    up.longitude,
    up.location_city,
    up.is_discoverable,
    up.status,
    up.last_active
  FROM trips t
  JOIN users u ON t.user_id = u.id
  LEFT JOIN user_profiles up ON up.user_id = u.id
  WHERE t.is_public = true 
  AND t.user_id != $1
  AND t.start_date >= CURRENT_DATE - INTERVAL '30 days'
`

    const queryParams = [currentUserId]
    let paramCount = 1

    // ✅ Add destination filter
    if (destination && destination.trim()) {
      paramCount++
      query += ` AND LOWER(t.destination) LIKE LOWER($${paramCount})`
      queryParams.push(`%${destination.trim()}%`)
    }

    // ✅ Add interests filter
    if (interests && interests.trim()) {
      const interestArray = interests
        .split(",")
        .map((i) => i.trim())
        .filter((i) => i.length > 0)
      if (interestArray.length > 0) {
        paramCount++
        query += ` AND (t.interests ?| $${paramCount} OR up.interests ?| $${paramCount})`
        queryParams.push(interestArray)
      }
    }

    // ✅ Add sorting
    switch (sortBy) {
      case "popular":
        query += ` ORDER BY COALESCE(r.rating, 0) DESC, t.created_at DESC`
        break
      case "budget":
        query += ` ORDER BY t.budget ASC, t.created_at DESC`
        break
      case "duration":
        query += ` ORDER BY t.days ASC, t.created_at DESC`
        break
      case "recent":
      default:
        query += ` ORDER BY t.created_at DESC`
        break
    }

    // ✅ Add pagination
    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`
    queryParams.push(Number.parseInt(limit), Number.parseInt(offset))

    console.log(`🔍 Executing query with ${queryParams.length} parameters`)
    const result = await pool.query(query, queryParams)
    console.log(`✅ Found ${result.rows.length} public trips`)

    const travelers = []

    // ✅ Process each trip and add connection status
    for (const trip of result.rows) {
      try {
        const connectionInfo = await getSimpleConnectionStatus(currentUserId, trip.user_id)

        // ✅ Calculate distance if user location is provided
        let distance_km = null
        let distance_text = null

        if (latitude && longitude && trip.latitude && trip.longitude) {
          distance_km = calculateDistance(
            Number.parseFloat(latitude),
            Number.parseFloat(longitude),
            trip.latitude,
            trip.longitude,
          )

          if (distance_km < 1) {
            distance_text = `${Math.round(distance_km * 1000)}m away`
          } else {
            distance_text = `${Math.round(distance_km * 10) / 10}km away`
          }
        }

        travelers.push({
          ...trip,
          connection_status: connectionInfo.status,
          room_id: connectionInfo.room_id,
          interests: trip.interests || [],
          profile_interests: trip.profile_interests || [],
          distance_km,
          distance_text,
        })
      } catch (travelerError) {
        console.error(`Error processing traveler ${trip.user_id}:`, travelerError)
        continue
      }
    }

    console.log(`✅ Processed ${travelers.length} travelers with connection status`)

    res.json({
      success: true,
      travelers,
      trips: travelers, // for backward compatibility
      total: travelers.length,
      sortedBy: sortBy,
      hasMore: travelers.length === Number.parseInt(limit),
    })
  } catch (error) {
    console.error("💥 Error discovering travelers:", error)
    res.status(500).json({
      success: false,
      message: "Failed to discover travelers",
      error: error.message,
      debug: process.env.NODE_ENV === "development" ? error.stack : undefined,
    })
  }
}

// GET CONNECTED CHATS
export const getConnectedChats = async (req, res) => {
  try {
    console.log("🔍 === GET CONNECTED CHATS DEBUG ===")
    console.log("👤 req.user:", JSON.stringify(req.user, null, 2))

    // Flexible user ID extraction
    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing",
        debug: { reqUser: req.user },
      })
    }

    const userIdInt = Number.parseInt(String(userId))
    if (isNaN(userIdInt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
        debug: { userId, userIdInt },
      })
    }

    console.log(`🔍 Fetching connected chats for user ${userIdInt}`)

    // ✅ ENHANCED: Get all connected users with their latest messages
    const chatsQuery = `
      WITH user_connections_expanded AS (
        SELECT 
          CASE 
            WHEN uc.user1_id = $1 THEN uc.user2_id 
            ELSE uc.user1_id 
          END as other_user_id,
          uc.room_id,
          uc.status,
          uc.updated_at as connection_updated
        FROM user_connections uc
        WHERE (uc.user1_id = $1 OR uc.user2_id = $1) 
        AND uc.status = 'connected'
        AND uc.room_id IS NOT NULL
      ),
      latest_messages AS (
        SELECT DISTINCT ON (cm.room_id)
          cm.room_id,
          cm.message_text as last_message,
          cm.created_at as last_message_time,
          cm.sender_id as last_sender_id
        FROM chat_messages cm
        WHERE cm.room_id IN (SELECT room_id FROM user_connections_expanded)
        ORDER BY cm.room_id, cm.created_at DESC
      )
      SELECT 
        uce.other_user_id as user_id,
        u.name as user_name,
        u.email as user_email,
        u.avatar_url,
        uce.room_id,
        uce.status as connection_status,
        uce.connection_updated,
        COALESCE(lm.last_message, 'No messages yet') as last_message,
        COALESCE(lm.last_message_time, uce.connection_updated) as last_message_time,
        lm.last_sender_id,
        -- Count unread messages (messages sent by other user after user's last seen)
        COALESCE((
          SELECT COUNT(*)
          FROM chat_messages cm2
          WHERE cm2.room_id = uce.room_id
          AND cm2.sender_id = uce.other_user_id
          AND cm2.created_at > COALESCE(
            (SELECT MAX(created_at) FROM chat_messages WHERE room_id = uce.room_id AND sender_id = $1),
            '1970-01-01'::timestamp
          )
        ), 0) as unread_count
      FROM user_connections_expanded uce
      JOIN users u ON uce.other_user_id = u.id
      LEFT JOIN latest_messages lm ON uce.room_id = lm.room_id
      ORDER BY COALESCE(lm.last_message_time, uce.connection_updated) DESC
    `

    const chatsResult = await pool.query(chatsQuery, [userIdInt])

    console.log(`✅ Found ${chatsResult.rows.length} connected chats for user ${userIdInt}`)

    // ✅ ENHANCED: Format the response with better data
    const formattedChats = chatsResult.rows.map((chat) => ({
      user_id: chat.user_id,
      user_name: chat.user_name,
      user_email: chat.user_email,
      avatar_url: chat.avatar_url,
      room_id: chat.room_id,
      connection_status: chat.connection_status,
      last_message: chat.last_message,
      last_message_time: chat.last_message_time,
      last_sender_id: chat.last_sender_id,
      unread_count: Number.parseInt(chat.unread_count) || 0,
      is_last_message_mine: chat.last_sender_id === userIdInt,
    }))

    res.json({
      success: true,
      chats: formattedChats,
      connectedUsers: formattedChats, // for backward compatibility
      count: formattedChats.length,
      total: formattedChats.length,
      debug: {
        userId: userIdInt,
        queryExecuted: true,
      },
    })
  } catch (error) {
    console.error("💥 Error fetching connected chats:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch connected chats",
      error: error.message,
      debug: process.env.NODE_ENV === "development" ? error.stack : undefined,
    })
  }
}

// GET NEARBY BY DISTANCE
export const getNearbyByDistance = async (req, res) => {
  try {
    const currentUserId = Number.parseInt(req.user.userId)
    const { limit = 20 } = req.query

    const nearbyQuery = `
      WITH traveler_distances AS (
        SELECT 
          t.user_id,
          u.name as user_name,
          u.email as user_email,
          u.avatar_url,
          t.destination,
          t.start_location,
          t.days,
          t.budget,
          t.travelers,
          t.interests,
          t.start_date,
          t.end_date,
          t.created_at,
          CASE 
            WHEN t.start_location IS NOT NULL AND t.destination IS NOT NULL THEN
              ABS(LENGTH(t.destination) - LENGTH(t.start_location)) * 100 + RANDOM() * 1000
            ELSE 0
          END as total_distance_traveled
        FROM trips t
        JOIN users u ON t.user_id = u.id
        WHERE t.is_public = true 
        AND t.user_id != $1
        AND t.start_date >= CURRENT_DATE - INTERVAL '30 days'
        AND t.start_location IS NOT NULL
        AND t.destination IS NOT NULL
      )
      SELECT *
      FROM traveler_distances
      WHERE total_distance_traveled > 0
      ORDER BY total_distance_traveled DESC
      LIMIT $2
    `

    const result = await pool.query(nearbyQuery, [currentUserId, limit])

    const nearbyTravelers = []

    for (const traveler of result.rows) {
      try {
        const connectionInfo = await getSimpleConnectionStatus(currentUserId, traveler.user_id)
        nearbyTravelers.push({
          ...traveler,
          connection_status: connectionInfo.status,
          room_id: connectionInfo.room_id,
          interests: traveler.interests || [],
        })
      } catch (travelerError) {
        console.error(`Error processing nearby traveler ${traveler.user_id}:`, traveler.user_id)
        continue
      }
    }

    res.json({
      success: true,
      nearbyTravelers,
      sortedBy: "distance_traveled",
    })
  } catch (error) {
    console.error("Error getting nearby travelers by distance:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get nearby travelers",
      error: error.message,
    })
  }
}

// GET NEARBY TRAVELERS
export const getNearbyTravelers = async (req, res) => {
  try {
    const currentUserId = Number.parseInt(req.user.userId)
    const { latitude, longitude, radius = 50, limit = 20 } = req.query

    if (!latitude || !longitude) {
      return getNearbyByDistance(req, res)
    }

    const nearbyQuery = `
      SELECT 
        t.*,
        u.name as user_name,
        u.email as user_email,
        u.avatar_url,
        up.interests as profile_interests,
        up.travel_style,
        up.latitude,
        up.longitude,
        up.location_city,
        (
          6371 * acos(
            cos(radians($2::float)) * cos(radians(up.latitude::float)) *
            cos(radians(up.longitude::float) - radians($3::float)) +
            sin(radians($2::float)) * sin(radians(up.latitude::float))
          )
        ) as distance_km
      FROM trips t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE t.is_public = true 
      AND t.user_id != $1
      AND up.is_discoverable = true
      AND up.latitude IS NOT NULL 
      AND up.longitude IS NOT NULL
      AND t.start_date >= CURRENT_DATE - INTERVAL '30 days'
      AND (
        6371 * acos(
          cos(radians($2::float)) * cos(radians(up.latitude::float)) *
          cos(radians(up.longitude::float) - radians($3::float)) +
          sin(radians($2::float)) * sin(radians(up.latitude::float))
        )
      ) <= $4
      ORDER BY distance_km ASC
      LIMIT $5
    `

    const result = await pool.query(nearbyQuery, [
      currentUserId,
      Number.parseFloat(latitude),
      Number.parseFloat(longitude),
      Number.parseFloat(radius),
      Number.parseInt(limit),
    ])

    const nearbyTravelers = []

    for (const traveler of result.rows) {
      try {
        const connectionInfo = await getSimpleConnectionStatus(currentUserId, traveler.user_id)
        nearbyTravelers.push({
          ...traveler,
          connection_status: connectionInfo.status,
          room_id: connectionInfo.room_id,
          interests: traveler.interests || [],
        })
      } catch (travelerError) {
        console.error(`Error processing nearby traveler ${traveler.user_id}:`, traveler.user_id)
        continue
      }
    }

    res.json({
      success: true,
      nearbyTravelers,
      radius: Number.parseFloat(radius),
      userLocation: { latitude: Number.parseFloat(latitude), longitude: Number.parseFloat(longitude) },
    })
  } catch (error) {
    console.error("Error getting nearby travelers:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get nearby travelers",
      error: error.message,
    })
  }
}

// UPDATE LOCATION
export const updateLocation = async (req, res) => {
  try {
    const userId = req.user.userId
    const { latitude, longitude, location_name } = req.body

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      })
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates",
      })
    }

    console.log(`📍 Updating location for user ${userId}: ${latitude}, ${longitude}`)

    // ✅ NEW: Reverse geocoding to get address from coordinates
    let addressInfo = {
      city: null,
      state: null,
      country: null,
      formatted_address: location_name || null,
    }

    try {
      // Using a simple reverse geocoding API (you can replace with your preferred service)
      const geocodeResponse = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
      )

      if (geocodeResponse.ok) {
        const geocodeData = await geocodeResponse.json()
        addressInfo = {
          city: geocodeData.city || geocodeData.locality || null,
          state: geocodeData.principalSubdivision || null,
          country: geocodeData.countryName || null,
          formatted_address: geocodeData.locality
            ? `${geocodeData.locality}, ${geocodeData.principalSubdivision || ""}, ${geocodeData.countryName || ""}`
            : location_name || `${latitude}, ${longitude}`,
        }
        console.log(`🗺️ Reverse geocoded address:`, addressInfo)
      }
    } catch (geocodeError) {
      console.warn("⚠️ Reverse geocoding failed:", geocodeError.message)
      // Continue with coordinate-only storage
    }

    // ✅ ENHANCED: Update user location with address information
    await pool.query(
      `UPDATE user_profiles 
       SET latitude = $1, longitude = $2, location_city = $3, location_state = $4, 
           location_country = $5, formatted_address = $6, location_updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $7`,
      [
        latitude,
        longitude,
        addressInfo.city,
        addressInfo.state,
        addressInfo.country,
        addressInfo.formatted_address,
        userId,
      ],
    )

    // ✅ NEW: Also store in location_history table for tracking
    try {
      await pool.query(
        `INSERT INTO location_history (user_id, latitude, longitude, city, state, country, formatted_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          userId,
          latitude,
          longitude,
          addressInfo.city,
          addressInfo.state,
          addressInfo.country,
          addressInfo.formatted_address,
        ],
      )
      console.log(`📝 Location history recorded for user ${userId}`)
    } catch (historyError) {
      console.warn("⚠️ Failed to record location history:", historyError.message)
      // Don't fail the main request if history fails
    }

    res.json({
      success: true,
      message: "Location updated successfully",
      location: {
        latitude,
        longitude,
        city: addressInfo.city,
        state: addressInfo.state,
        country: addressInfo.country,
        formatted_address: addressInfo.formatted_address,
        location_name: location_name,
        updated_at: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("❌ Error updating location:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update location",
      error: error.message,
    })
  }
}

// TOGGLE DISCOVERY
export const toggleDiscovery = async (req, res) => {
  try {
    const userId = req.user.userId
    const { is_discoverable } = req.body

    await pool.query(
      `UPDATE user_profiles 
       SET is_discoverable = $1
       WHERE user_id = $2`,
      [is_discoverable, userId],
    )

    res.json({
      success: true,
      message: `Discovery ${is_discoverable ? "enabled" : "disabled"}`,
      is_discoverable,
    })
  } catch (error) {
    console.error("❌ Error toggling discovery:", error)
    res.status(500).json({
      success: false,
      message: "Failed to toggle discovery",
      error: error.message,
    })
  }
}

// ✅ NEW: Get user location for social features (enhanced with formatted address)
export const getUserLocationForSocial = async (req, res) => {
  try {
    const requesterId = req.user.userId
    const { targetUserId } = req.params

    console.log(`📍 Social: User ${requesterId} requesting location of user ${targetUserId}`)

    // Check if users are connected
    const connectionResult = await pool.query(
      `SELECT status FROM user_connections 
       WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1) 
       AND status = 'connected'`,
      [requesterId, targetUserId],
    )

    if (connectionResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You must be connected to view this user's location",
        canRequestLocation: false,
      })
    }

    // Get target user's profile and location with enhanced address data
    const userResult = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.avatar_url, 
        up.latitude, up.longitude, up.location_city, up.location_state, 
        up.location_country, up.formatted_address, up.location_updated_at, up.is_discoverable 
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = $1`,
      [targetUserId],
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        canRequestLocation: false,
      })
    }

    const userData = userResult.rows[0]

    // Check if user has location sharing enabled
    if (!userData.is_discoverable) {
      return res.status(403).json({
        success: false,
        message: "This user has disabled location sharing",
        canRequestLocation: true,
        locationShared: false,
        user: {
          id: userData.id,
          name: userData.name,
          avatar_url: userData.avatar_url,
        },
      })
    }

    // Check if location data exists
    if (!userData.latitude || !userData.longitude) {
      return res.status(404).json({
        success: false,
        message: "Location not available for this user",
        canRequestLocation: true,
        locationShared: false,
        user: {
          id: userData.id,
          name: userData.name,
          avatar_url: userData.avatar_url,
        },
      })
    }

    // ✅ Calculate distance between users
    let distanceInfo = null
    try {
      const requesterLocationResult = await pool.query(
        `SELECT latitude, longitude FROM user_profiles WHERE user_id = $1`,
        [requesterId],
      )

      if (requesterLocationResult.rows.length > 0 && requesterLocationResult.rows[0].latitude) {
        const requesterLat = requesterLocationResult.rows[0].latitude
        const requesterLng = requesterLocationResult.rows[0].longitude
        const targetLat = userData.latitude
        const targetLng = userData.longitude

        // Calculate distance using Haversine formula
        const R = 6371 // Earth's radius in kilometers
        const dLat = ((targetLat - requesterLat) * Math.PI) / 180
        const dLng = ((targetLng - requesterLng) * Math.PI) / 180
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((requesterLat * Math.PI) / 180) *
            Math.cos((targetLat * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        const distance = R * c

        distanceInfo = {
          distance: distance,
          distanceText: distance < 1 ? `${Math.round(distance * 1000)}m away` : `${distance.toFixed(1)}km away`,
        }
      }
    } catch (distanceError) {
      console.warn("⚠️ Failed to calculate distance:", distanceError.message)
    }

    res.json({
      success: true,
      locationShared: true,
      user: {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        avatar_url: userData.avatar_url,
        status: "online",
      },
      location: {
        latitude: userData.latitude,
        longitude: userData.longitude,
        city: userData.location_city,
        state: userData.location_state,
        country: userData.location_country,
        formatted_address: userData.formatted_address || `${userData.latitude}, ${userData.longitude}`,
        current_location:
          userData.formatted_address ||
          `${userData.location_city || "Unknown"}, ${userData.location_country || "Unknown"}`,
        updated_at: userData.location_updated_at,
        ...distanceInfo,
      },
      connectionInfo: {
        status: "connected",
      },
    })
  } catch (error) {
    console.error("❌ Error getting user location for social:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get user location",
      error: error.message,
    })
  }
}
