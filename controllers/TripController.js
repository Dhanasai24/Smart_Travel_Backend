import pool from "../config/database.js"
import UnsplashService from "../ApiServices/UnplashApi.js"

// Helper function to check if column exists
const checkColumnExists = async (tableName, columnName) => {
  try {
    const result = await pool.query(
      `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1 AND column_name = $2
    `,
      [tableName, columnName],
    )
    return result.rows.length > 0
  } catch (error) {
    console.error(`Error checking column ${columnName}:`, error)
    return false
  }
}

// ✅ FIXED: Proper data formatting for PostgreSQL
const ensureCorrectFormat = (data, columnName) => {
  console.log(`🔧 Processing ${columnName}:`, typeof data, data)

  // Handle PostgreSQL ARRAY columns (interests, food_preferences)
  if (columnName === "interests" || columnName === "food_preferences") {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return null // PostgreSQL will use default empty array
    }

    // ✅ Return as JavaScript array for PostgreSQL ARRAY type
    const cleanArray = data.filter((item) => item && typeof item === "string" && item.trim()).map((item) => item.trim())

    console.log(`✅ ${columnName} (PostgreSQL ARRAY):`, cleanArray)
    return cleanArray
  }

  // Handle JSONB columns (trip_plan, transport_plan, weather_data, etc.)
  if (["trip_plan", "transport_plan", "weather_data", "activity_completions", "progress_stats"].includes(columnName)) {
    if (data === null || data === undefined) {
      return null
    }

    // If it's already an object/array, return as-is for JSONB
    if (typeof data === "object") {
      console.log(`✅ ${columnName} (JSONB object):`, typeof data)
      return data
    }

    // If it's a string, try to parse it
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data)
        console.log(`✅ ${columnName} parsed to JSONB:`, typeof parsed)
        return parsed
      } catch (e) {
        console.log(`⚠️ ${columnName} couldn't parse, returning as string`)
        return data
      }
    }

    return data
  }

  // For text columns
  return data
}

export const saveTrip = async (req, res) => {
  try {
    const {
      title,
      destination,
      start_location,
      days,
      budget,
      travelers,
      start_date,
      end_date,
      food_preferences,
      interests,
      special_interest,
      trip_plan,
      transport_plan,
      weather_data,
    } = req.body

    const userId = req.user.userId

    console.log("💾 RAW DATA RECEIVED:")
    console.log("- food_preferences:", typeof food_preferences, food_preferences)
    console.log("- interests:", typeof interests, interests)
    console.log("- trip_plan:", typeof trip_plan, trip_plan ? "Present" : "Missing")

    // Get thumbnail
    let thumbnailUrl = null
    let unsplashPhotoId = null

    try {
      const imageData = await UnsplashService.getDestinationImage(destination, 1600, 900)
      thumbnailUrl = imageData.url
      unsplashPhotoId = imageData.unsplashId
      if (imageData.downloadLocation) {
        await UnsplashService.triggerDownload(imageData.downloadLocation)
      }
    } catch (error) {
      console.error("❌ Thumbnail error:", error)
      thumbnailUrl = `https://source.unsplash.com/1600x900/?${encodeURIComponent(destination)},travel,landmark`
    }

    // Calculate progress stats
    const progressStats = { completed: 0, total: 0, percentage: 0 }
    if (trip_plan && trip_plan.days) {
      const totalActivities = trip_plan.days.reduce((total, day) => {
        return total + (day.activities ? day.activities.length : 0)
      }, 0)
      progressStats.total = totalActivities
    }

    // Check optional columns
    const hasVisibility = await checkColumnExists("trips", "visibility")
    const hasIsPublic = await checkColumnExists("trips", "is_public")
    const hasActivityCompletions = await checkColumnExists("trips", "activity_completions")
    const hasProgressStats = await checkColumnExists("trips", "progress_stats")

    // ✅ FIXED: Proper formatting for PostgreSQL types
    const formattedFoodPreferences = ensureCorrectFormat(food_preferences, "food_preferences")
    const formattedInterests = ensureCorrectFormat(interests, "interests")
    const formattedTripPlan = ensureCorrectFormat(trip_plan, "trip_plan")
    const formattedTransportPlan = ensureCorrectFormat(transport_plan, "transport_plan")
    const formattedWeatherData = ensureCorrectFormat(weather_data, "weather_data")

    console.log("🔍 FORMATTED DATA:")
    console.log("- formattedFoodPreferences:", formattedFoodPreferences)
    console.log("- formattedInterests:", formattedInterests)
    console.log("- formattedTripPlan:", typeof formattedTripPlan)

    // Build query
    const insertQuery = `
      INSERT INTO trips (
        user_id, title, destination, start_location, days, budget, travelers,
        start_date, end_date, food_preferences, interests, special_interest,
        trip_plan, transport_plan, weather_data, status, thumbnail_url, unsplash_photo_id
        ${hasActivityCompletions ? ", activity_completions" : ""}
        ${hasProgressStats ? ", progress_stats" : ""}
        ${hasVisibility ? ", visibility" : ""}
        ${hasIsPublic ? ", is_public" : ""}
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        ${hasActivityCompletions ? ", $19" : ""}
        ${hasProgressStats ? ", $20" : ""}
        ${hasVisibility ? ", $21" : ""}
        ${hasIsPublic ? ", $22" : ""}
      ) RETURNING *
    `

    const insertValues = [
      userId, // $1
      title, // $2
      destination, // $3
      start_location, // $4
      days, // $5
      budget, // $6
      travelers || 1, // $7
      start_date, // $8
      end_date, // $9
      formattedFoodPreferences, // $10 - PostgreSQL ARRAY
      formattedInterests, // $11 - PostgreSQL ARRAY (FIXED!)
      special_interest, // $12 - text
      formattedTripPlan, // $13 - JSONB object
      formattedTransportPlan, // $14 - JSONB object
      formattedWeatherData, // $15 - JSONB object
      "planned", // $16
      thumbnailUrl, // $17
      unsplashPhotoId, // $18
    ]

    // Add optional columns
    if (hasActivityCompletions) {
      insertValues.push(ensureCorrectFormat({}, "activity_completions"))
    }
    if (hasProgressStats) {
      insertValues.push(ensureCorrectFormat(progressStats, "progress_stats"))
    }
    if (hasVisibility) {
      insertValues.push("private")
    }
    if (hasIsPublic) {
      insertValues.push(false)
    }

    console.log("🔍 FINAL VALUES TO INSERT:")
    insertValues.forEach((value, index) => {
      console.log(
        `  $${index + 1}:`,
        typeof value,
        Array.isArray(value) ? `Array[${value.length}]` : JSON.stringify(value),
      )
    })

    // ✅ EXECUTE WITH DETAILED ERROR HANDLING
    const newTrip = await pool.query(insertQuery, insertValues)
    const savedTrip = newTrip.rows[0]

    console.log("✅ Trip saved successfully with ID:", savedTrip.id)

    res.status(201).json({
      message: "Trip saved successfully",
      trip: savedTrip,
    })
  } catch (error) {
    console.error("❌ DETAILED SAVE ERROR:")
    console.error("- Message:", error.message)
    console.error("- Code:", error.code)
    console.error("- Detail:", error.detail)
    console.error("- Where:", error.where)
    console.error("- Full error:", error)

    res.status(500).json({
      message: `Server error: ${error.message}`,
      detail: error.detail,
      where: error.where,
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    })
  }
}

export const getUserTrips = async (req, res) => {
  try {
    const userId = req.user.userId

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    console.log("📋 Fetching trips for user:", userId)

    const query = `
  SELECT 
    id, title, destination, start_location, days, budget, travelers,
    start_date, end_date, created_at, updated_at, status, thumbnail_url,
    unsplash_photo_id, is_favorite,
    COALESCE(visibility, 'private') as visibility,
    COALESCE(is_public, false) as is_public,
    COALESCE(food_preferences, ARRAY[]::text[]) as food_preferences,
    COALESCE(interests, ARRAY[]::text[]) as interests,
    COALESCE(activity_completions, '{}'::jsonb) as activity_completions,
    COALESCE(progress_stats, '{"completed": 0, "total": 0, "percentage": 0}'::jsonb) as progress_stats,
    rating,
    CASE 
      WHEN trip_plan IS NOT NULL THEN 
        COALESCE(trip_plan->>'summary', 'No summary available')
      ELSE 'No summary available'
    END as summary,
    CASE 
      WHEN trip_plan IS NOT NULL THEN 
        COALESCE(trip_plan->>'totalEstimatedCost', '0')
      ELSE '0'
    END as total_cost
  FROM trips 
  WHERE user_id = $1 
  ORDER BY created_at DESC
`

    const result = await pool.query(query, [userId])

    console.log(`📋 Found ${result.rows.length} trips for user ${userId}`)

    res.status(200).json({
      trips: result.rows,
    })
  } catch (error) {
    console.error("❌ Error fetching trips:", error)
    res.status(500).json({
      message: "Failed to fetch trips",
      error: error.message,
    })
  }
}

export const getTripById = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    console.log(`📋 Fetching trip ${id} for user ${userId}`)

    const query = `
      SELECT * FROM trips 
      WHERE id = $1 AND user_id = $2
    `

    const result = await pool.query(query, [id, userId])

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Trip not found" })
    }

    const trip = result.rows[0]

    console.log(`✅ Successfully fetched trip ${id}`)

    res.status(200).json({
      trip: trip,
    })
  } catch (error) {
    console.error("❌ Error fetching trip:", error)
    res.status(500).json({
      message: "Failed to fetch trip",
      error: error.message,
    })
  }
}

export const updateActivityCompletion = async (req, res) => {
  try {
    const { id } = req.params
    const { dayIndex, activityIndex, completed } = req.body
    const userId = req.user.userId

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    console.log(`🎯 Updating activity completion for trip ${id}:`, { dayIndex, activityIndex, completed })

    const hasActivityCompletions = await checkColumnExists("trips", "activity_completions")
    const hasProgressStats = await checkColumnExists("trips", "progress_stats")

    if (!hasActivityCompletions || !hasProgressStats) {
      return res.status(400).json({
        message: "Activity completion feature not available. Please run database migration.",
      })
    }

    const tripQuery = `SELECT activity_completions, trip_plan FROM trips WHERE id = $1 AND user_id = $2`
    const tripResult = await pool.query(tripQuery, [id, userId])

    if (tripResult.rows.length === 0) {
      return res.status(404).json({ message: "Trip not found" })
    }

    const { activity_completions, trip_plan } = tripResult.rows[0]

    const completions = activity_completions || {}
    const key = `${dayIndex}-${activityIndex}`
    completions[key] = completed

    let totalActivities = 0
    let completedActivities = 0

    if (trip_plan && trip_plan.days) {
      trip_plan.days.forEach((day, dIndex) => {
        if (day.activities) {
          day.activities.forEach((activity, aIndex) => {
            totalActivities++
            const activityKey = `${dIndex + 1}-${aIndex}`
            if (completions[activityKey]) {
              completedActivities++
            }
          })
        }
      })
    }

    const progressStats = {
      completed: completedActivities,
      total: totalActivities,
      percentage: totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0,
    }

    const updateQuery = `
      UPDATE trips 
      SET activity_completions = $1, progress_stats = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `

    const updateResult = await pool.query(updateQuery, [completions, progressStats, id, userId])

    console.log(
      `✅ Activity completion updated. Progress: ${progressStats.completed}/${progressStats.total} (${progressStats.percentage}%)`,
    )

    res.status(200).json({
      message: "Activity completion updated successfully",
      trip: updateResult.rows[0],
      progressStats,
    })
  } catch (error) {
    console.error("❌ Error updating activity completion:", error)
    res.status(500).json({
      message: "Failed to update activity completion",
      error: error.message,
    })
  }
}

export const deleteTrip = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    const query = `
      DELETE FROM trips 
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `

    const result = await pool.query(query, [id, userId])

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Trip not found or unauthorized" })
    }

    res.status(200).json({
      message: "Trip deleted successfully",
      id: result.rows[0].id,
    })
  } catch (error) {
    console.error("❌ Error deleting trip:", error)
    res.status(500).json({
      message: "Failed to delete trip",
      error: error.message,
    })
  }
}

export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    const getQuery = `
      SELECT is_favorite FROM trips 
      WHERE id = $1 AND user_id = $2
    `

    const getResult = await pool.query(getQuery, [id, userId])

    if (getResult.rows.length === 0) {
      return res.status(404).json({ message: "Trip not found or unauthorized" })
    }

    const currentStatus = getResult.rows[0].is_favorite || false

    const updateQuery = `
      UPDATE trips 
      SET is_favorite = $1 
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `

    const updateResult = await pool.query(updateQuery, [!currentStatus, id, userId])

    res.status(200).json({
      message: `Trip ${!currentStatus ? "added to" : "removed from"} favorites`,
      trip: updateResult.rows[0],
    })
  } catch (error) {
    console.error("❌ Error toggling favorite status:", error)
    res.status(500).json({
      message: "Failed to update favorite status",
      error: error.message,
    })
  }
}

export const regenerateThumbnail = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    console.log(`🔄 Regenerating thumbnail for trip ${id}`)

    const tripQuery = `SELECT destination FROM trips WHERE id = $1 AND user_id = $2`
    const tripResult = await pool.query(tripQuery, [id, userId])

    if (tripResult.rows.length === 0) {
      return res.status(404).json({ message: "Trip not found" })
    }

    const { destination } = tripResult.rows[0]

    const imageData = await UnsplashService.getDestinationImage(destination, 1600, 900)

    console.log(`✅ Generated new thumbnail for ${destination}: ${imageData.url}`)

    const updateQuery = `
      UPDATE trips 
      SET thumbnail_url = $1, unsplash_photo_id = $2
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `

    const updateResult = await pool.query(updateQuery, [imageData.url, imageData.unsplashId, id, userId])

    if (imageData.downloadLocation) {
      await UnsplashService.triggerDownload(imageData.downloadLocation)
    }

    res.status(200).json({
      message: "Thumbnail regenerated successfully",
      trip: updateResult.rows[0],
      imageData: imageData,
    })
  } catch (error) {
    console.error("❌ Error regenerating thumbnail:", error)
    res.status(500).json({
      message: "Failed to regenerate thumbnail",
      error: error.message,
    })
  }
}

export const testUnsplash = async (req, res) => {
  try {
    console.log("🧪 Testing Unsplash API endpoint...")

    const connectionTest = await UnsplashService.testConnection()

    if (connectionTest) {
      const testImage = await UnsplashService.getDestinationImage("Paris", 800, 600)

      res.status(200).json({
        message: "Unsplash API is working correctly",
        connectionTest: true,
        sampleImage: testImage,
      })
    } else {
      res.status(500).json({
        message: "Unsplash API connection failed",
        connectionTest: false,
      })
    }
  } catch (error) {
    console.error("❌ Error testing Unsplash API:", error)
    res.status(500).json({
      message: "Error testing Unsplash API",
      error: error.message,
    })
  }
}

export const toggleVisibility = async (req, res) => {
  try {
    const { id } = req.params
    const { isPublic } = req.body
    const userId = req.user.userId

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    console.log(`🔄 Toggling visibility for trip ${id} to ${isPublic ? "public" : "private"}`)

    const hasVisibility = await checkColumnExists("trips", "visibility")
    const hasIsPublic = await checkColumnExists("trips", "is_public")

    if (!hasVisibility || !hasIsPublic) {
      return res.status(400).json({
        message: "Social features not available. Please run database migration.",
      })
    }

    const newVisibility = isPublic ? "public" : "private"

    const updateQuery = `
      UPDATE trips 
      SET visibility = $1, is_public = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND user_id = $4
      RETURNING id, visibility, is_public
    `

    const updateResult = await pool.query(updateQuery, [newVisibility, isPublic, id, userId])

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: "Trip not found or unauthorized" })
    }

    const updatedTrip = updateResult.rows[0]
    console.log(`✅ Trip ${id} visibility changed to ${newVisibility}`, updatedTrip)

    res.status(200).json({
      success: true,
      message: `Trip visibility changed to ${newVisibility}`,
      trip: updatedTrip,
    })
  } catch (error) {
    console.error("❌ Error toggling visibility:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update trip visibility",
      error: error.message,
    })
  }
}

export const getPublicTrips = async (req, res) => {
  try {
    const userId = req.user.userId
    const { destination, interests, limit = 20, offset = 0 } = req.query

    const hasIsPublic = await checkColumnExists("trips", "is_public")

    if (!hasIsPublic) {
      return res.json({
        success: false,
        message: "Social features not available. Please run database migration.",
        trips: [],
      })
    }

    let query = `
      SELECT 
        t.*,
        u.name as user_name,
        u.email as user_email
      FROM trips t
      JOIN users u ON t.user_id = u.id
      WHERE t.is_public = true 
      AND t.user_id != $1
      AND t.start_date >= CURRENT_DATE
    `

    const queryParams = [userId]
    let paramCount = 1

    if (destination) {
      paramCount++
      query += ` AND LOWER(t.destination) LIKE LOWER($${paramCount})`
      queryParams.push(`%${destination}%`)
    }

    if (interests) {
      const interestArray = interests.split(",")
      paramCount++
      query += ` AND t.interests && $${paramCount}`
      queryParams.push(interestArray)
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`
    queryParams.push(limit, offset)

    const result = await pool.query(query, queryParams)

    console.log(`📋 Found ${result.rows.length} public trips`)

    res.json({
      success: true,
      trips: result.rows,
    })
  } catch (error) {
    console.error("Error fetching public trips:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch public trips",
      error: error.message,
    })
  }
}

export const findMatches = async (req, res) => {
  try {
    const userId = req.user.userId

    const hasIsPublic = await checkColumnExists("trips", "is_public")

    if (!hasIsPublic) {
      return res.json({
        success: false,
        message: "Social features not available. Please run database migration.",
        matches: [],
      })
    }

    const userTripsResult = await pool.query(
      `SELECT * FROM trips 
       WHERE user_id = $1 
       AND start_date >= CURRENT_DATE 
       AND status IN ('planned', 'active')`,
      [userId],
    )

    if (userTripsResult.rows.length === 0) {
      return res.json({
        success: true,
        matches: [],
        message: "No active trips found for matching",
      })
    }

    const matches = []

    for (const userTrip of userTripsResult.rows) {
      const matchQuery = `
        SELECT 
          t.*,
          u.name as user_name,
          u.email as user_email,
          CASE 
            WHEN LOWER(t.destination) = LOWER($2) THEN 100
            WHEN LOWER(t.destination) LIKE LOWER($3) OR LOWER($2) LIKE LOWER('%' || t.destination || '%') THEN 75
            ELSE 0
          END as destination_similarity,
          
          CASE 
            WHEN t.start_date = $4 AND t.end_date = $5 THEN 100
            WHEN t.start_date <= $5 AND t.end_date >= $4 THEN 
              GREATEST(0, 100 - ABS(EXTRACT(DAY FROM (t.start_date::date - $4::date))) * 10)
            ELSE 0
          END as date_compatibility,
          
          CASE 
            WHEN t.interests && $6 THEN 50
            ELSE 0
          END as interest_overlap,
          
          CASE 
            WHEN ABS(t.budget::numeric - $7::numeric) <= ($7::numeric * 0.2) THEN 100
            WHEN ABS(t.budget::numeric - $7::numeric) <= ($7::numeric * 0.5) THEN 75
            WHEN ABS(t.budget::numeric - $7::numeric) <= ($7::numeric * 1.0) THEN 50
            ELSE 25
          END as budget_compatibility
          
        FROM trips t
        JOIN users u ON t.user_id = u.id
        WHERE t.is_public = true 
        AND t.user_id != $1
        AND t.start_date >= CURRENT_DATE
        AND (
          LOWER(t.destination) LIKE LOWER($3) OR
          t.start_date <= $5 AND t.end_date >= $4 OR
          t.interests && $6
        )
      `

      const matchResult = await pool.query(matchQuery, [
        userId,
        userTrip.destination,
        `%${userTrip.destination}%`,
        userTrip.start_date,
        userTrip.end_date,
        userTrip.interests || [],
        userTrip.budget || 0,
      ])

      for (const match of matchResult.rows) {
        const matchScore =
          match.destination_similarity * 0.4 +
          match.date_compatibility * 0.3 +
          match.interest_overlap * 0.2 +
          match.budget_compatibility * 0.1

        if (matchScore >= 30) {
          matches.push({
            ...match,
            user_trip_id: userTrip.id,
            user_trip_destination: userTrip.destination,
            match_score: Math.round(matchScore),
            match_factors: {
              destination_similarity: Math.round(match.destination_similarity),
              date_compatibility: Math.round(match.date_compatibility),
              interest_overlap: Math.round(match.interest_overlap),
              budget_compatibility: Math.round(match.budget_compatibility),
            },
          })
        }
      }
    }

    matches.sort((a, b) => b.match_score - a.match_score)

    console.log(`🎯 Found ${matches.length} trip matches for user ${userId}`)

    res.json({
      success: true,
      matches: matches.slice(0, 20),
    })
  } catch (error) {
    console.error("Error finding trip matches:", error)
    res.status(500).json({
      success: false,
      message: "Failed to find matches",
      error: error.message,
    })
  }
}
