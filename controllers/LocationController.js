import pool from "../config/database.js"

// Update user location with reverse geocoding
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

    // Validate coordinates
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

// Get user's current location with formatted address
export const getLocation = async (req, res) => {
  try {
    const userId = req.user.userId

    const result = await pool.query(
      `SELECT latitude, longitude, location_city, location_state, location_country, 
              formatted_address, location_updated_at
       FROM user_profiles 
       WHERE user_id = $1`,
      [userId],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      })
    }

    const location = result.rows[0]

    res.json({
      success: true,
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        city: location.location_city,
        state: location.location_state,
        country: location.location_country,
        formatted_address: location.formatted_address,
        updated_at: location.location_updated_at,
      },
    })
  } catch (error) {
    console.error("❌ Error getting location:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get location",
      error: error.message,
    })
  }
}

// ✅ NEW: Get another user's location (for location sharing)
export const getUserLocation = async (req, res) => {
  try {
    const requesterId = req.user.userId
    const { targetUserId } = req.params

    console.log(`📍 User ${requesterId} requesting location of user ${targetUserId}`)

    // Check if users are connected
    const connectionResult = await pool.query(
      `SELECT status FROM user_connections 
       WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [requesterId, targetUserId],
    )

    if (connectionResult.rows.length === 0 || connectionResult.rows[0].status !== "connected") {
      return res.status(403).json({
        success: false,
        message: "You must be connected to view this user's location",
      })
    }

    // Get target user's profile and location
    const userResult = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url,
              up.latitude, up.longitude, up.location_city, up.location_state, 
              up.location_country, up.formatted_address, up.location_updated_at,
              up.is_discoverable
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = $1`,
      [targetUserId],
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }

    const userData = userResult.rows[0]

    // Check if user has location sharing enabled
    if (!userData.is_discoverable) {
      return res.status(403).json({
        success: false,
        message: "This user has disabled location sharing",
        canRequestLocation: true,
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
        user: {
          id: userData.id,
          name: userData.name,
          avatar_url: userData.avatar_url,
        },
      })
    }

    // ✅ Calculate distance between users if requester has location
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
        status: "online", // You can enhance this with real status
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
    console.error("❌ Error getting user location:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get user location",
      error: error.message,
    })
  }
}

// Toggle discovery status
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
