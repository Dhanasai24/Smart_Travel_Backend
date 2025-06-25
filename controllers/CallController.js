import pool from "../config/database.js"

// ✅ INITIATE CALL
export const initiateCall = async (req, res) => {
  try {
    const callerId = req.user.userId
    const { receiverId, roomId, callType } = req.body

    if (!receiverId || !roomId || !callType) {
      return res.status(400).json({
        success: false,
        message: "Receiver ID, room ID, and call type are required",
      })
    }

    if (!["audio", "video"].includes(callType)) {
      return res.status(400).json({
        success: false,
        message: "Call type must be 'audio' or 'video'",
      })
    }

    console.log(`📞 Initiating ${callType} call from ${callerId} to ${receiverId}`)

    // Verify users are connected in this room
    const connectionCheck = await pool.query(
      `SELECT 1 FROM chat_participants cp1
       JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
       WHERE cp1.user_id = $1 AND cp2.user_id = $2 
       AND cp1.room_id = $3 AND cp1.status = 'accepted' AND cp2.status = 'accepted'`,
      [callerId, receiverId, roomId],
    )

    if (connectionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Users are not connected in this room",
      })
    }

    // Create call history entry
    const callResult = await pool.query(
      `INSERT INTO call_history (room_id, caller_id, receiver_id, call_type, status, started_at)
       VALUES ($1, $2, $3, $4, 'initiated', CURRENT_TIMESTAMP)
       RETURNING id`,
      [roomId, callerId, receiverId, callType],
    )

    const callId = callResult.rows[0].id

    // Get caller info
    const callerInfo = await pool.query(`SELECT name, avatar_url FROM users WHERE id = $1`, [callerId])

    res.json({
      success: true,
      callId,
      roomId,
      callType,
      status: "initiated",
      callerInfo: callerInfo.rows[0],
      message: `${callType} call initiated successfully`,
    })
  } catch (error) {
    console.error("❌ Error initiating call:", error)
    res.status(500).json({
      success: false,
      message: "Failed to initiate call",
      error: error.message,
    })
  }
}

// ✅ ACCEPT CALL
export const acceptCall = async (req, res) => {
  try {
    const { callId } = req.body
    const userId = req.user.userId

    console.log(`✅ User ${userId} accepting call ${callId}`)

    // Update call status
    const updateResult = await pool.query(
      `UPDATE call_history 
       SET status = 'accepted'
       WHERE id = $1 AND receiver_id = $2 AND status = 'initiated'
       RETURNING *`,
      [callId, userId],
    )

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Call not found or already processed",
      })
    }

    const call = updateResult.rows[0]

    res.json({
      success: true,
      callId,
      status: "accepted",
      call: call,
      message: "Call accepted successfully",
    })
  } catch (error) {
    console.error("❌ Error accepting call:", error)
    res.status(500).json({
      success: false,
      message: "Failed to accept call",
      error: error.message,
    })
  }
}

// ✅ REJECT CALL
export const rejectCall = async (req, res) => {
  try {
    const { callId } = req.body
    const userId = req.user.userId

    console.log(`❌ User ${userId} rejecting call ${callId}`)

    // Update call status
    const updateResult = await pool.query(
      `UPDATE call_history 
       SET status = 'rejected', ended_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND receiver_id = $2 AND status = 'initiated'
       RETURNING *`,
      [callId, userId],
    )

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Call not found or already processed",
      })
    }

    res.json({
      success: true,
      callId,
      status: "rejected",
      message: "Call rejected successfully",
    })
  } catch (error) {
    console.error("❌ Error rejecting call:", error)
    res.status(500).json({
      success: false,
      message: "Failed to reject call",
      error: error.message,
    })
  }
}

// ✅ END CALL
export const endCall = async (req, res) => {
  try {
    const { callId } = req.body
    const userId = req.user.userId

    console.log(`📞 User ${userId} ending call ${callId}`)

    // Calculate duration and update call
    const updateResult = await pool.query(
      `UPDATE call_history 
       SET status = 'ended', 
           ended_at = CURRENT_TIMESTAMP,
           duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))
       WHERE id = $1 AND (caller_id = $2 OR receiver_id = $2) AND status IN ('initiated', 'accepted')
       RETURNING *`,
      [callId, userId],
    )

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Call not found or already ended",
      })
    }

    const call = updateResult.rows[0]

    res.json({
      success: true,
      callId,
      status: "ended",
      duration: call.duration_seconds,
      message: "Call ended successfully",
    })
  } catch (error) {
    console.error("❌ Error ending call:", error)
    res.status(500).json({
      success: false,
      message: "Failed to end call",
      error: error.message,
    })
  }
}

// ✅ GET CALL HISTORY
export const getCallHistory = async (req, res) => {
  try {
    const userId = req.user.userId
    const { limit = 50, offset = 0 } = req.query

    console.log(`📞 Getting call history for user ${userId}`)

    const historyQuery = `
      SELECT 
        ch.*,
        caller.name as caller_name,
        caller.avatar_url as caller_avatar,
        receiver.name as receiver_name,
        receiver.avatar_url as receiver_avatar,
        cr.room_name
      FROM call_history ch
      JOIN users caller ON ch.caller_id = caller.id
      JOIN users receiver ON ch.receiver_id = receiver.id
      JOIN chat_rooms cr ON ch.room_id = cr.id
      WHERE ch.caller_id = $1 OR ch.receiver_id = $1
      ORDER BY ch.started_at DESC
      LIMIT $2 OFFSET $3
    `

    const result = await pool.query(historyQuery, [userId, limit, offset])

    res.json({
      success: true,
      callHistory: result.rows,
      count: result.rows.length,
    })
  } catch (error) {
    console.error("❌ Error getting call history:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get call history",
      error: error.message,
    })
  }
}
