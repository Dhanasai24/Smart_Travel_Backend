import pool from "../config/database.js"

// Test database connection
const testConnection = async () => {
  try {
    const result = await pool.query("SELECT NOW() as current_time")
    console.log("✅ Database connection test successful:", result.rows[0].current_time)
    return true
  } catch (error) {
    console.error("❌ Database connection test failed:", error)
    return false
  }
}

// Create a new review
export const createReview = async (req, res) => {
  try {
    console.log("🚀 === REVIEW CREATION START ===")
    console.log("📦 Full request body:", JSON.stringify(req.body, null, 2))
    console.log("👤 User from middleware:", req.user)

    // Test database connection first
    const dbConnected = await testConnection()
    if (!dbConnected) {
      return res.status(500).json({
        success: false,
        message: "Database connection failed",
      })
    }

    const {
      trip_id,
      destination,
      rating,
      title,
      review_text,
      images,
      travel_date,
      trip_duration,
      budget_spent,
      travel_style,
      highlights,
      tips,
      would_recommend,
      is_public,
    } = req.body

    // Extract user ID with multiple fallbacks
    const userId = req.user?.userId || req.user?.id || req.user?.user_id
    console.log("👤 Extracted user ID:", userId)

    if (!userId) {
      console.error("❌ No user ID found in request")
      return res.status(401).json({
        success: false,
        message: "User authentication required. Please log in again.",
      })
    }

    // Validate required fields
    if (!destination || !rating || !title || !review_text) {
      console.error("❌ Missing required fields")
      return res.status(400).json({
        success: false,
        message: "Destination, rating, title, and review text are required",
      })
    }

    // Validate rating
    const numRating = Number(rating)
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      console.error("❌ Invalid rating:", rating)
      return res.status(400).json({
        success: false,
        message: "Rating must be a number between 1 and 5",
      })
    }

    // Check if user exists
    console.log("👤 Checking if user exists...")
    const userCheck = await pool.query("SELECT id, name FROM users WHERE id = $1", [userId])
    if (userCheck.rows.length === 0) {
      console.error("❌ User not found in database:", userId)
      return res.status(404).json({
        success: false,
        message: "User not found. Please log in again.",
      })
    }
    console.log("✅ User exists:", userCheck.rows[0].name)

    // Process images - handle empty arrays properly for PostgreSQL
    let processedImages = null
    if (images && Array.isArray(images) && images.length > 0) {
      processedImages = JSON.stringify(images.slice(0, 5))
      console.log("📸 Processing images:", images.length)
    } else {
      processedImages = null // Use NULL instead of empty JSON array
      console.log("📸 No images provided")
    }

    // Process highlights - handle empty arrays properly for PostgreSQL
    let processedHighlights = null
    if (highlights && Array.isArray(highlights) && highlights.length > 0) {
      processedHighlights = JSON.stringify(highlights.slice(0, 5))
      console.log("⭐ Processing highlights:", highlights.length)
    } else {
      processedHighlights = null // Use NULL instead of empty JSON array
      console.log("⭐ No highlights provided")
    }

    // Prepare values for insertion - using NULL for empty arrays
    const values = [
      userId, // $1
      trip_id || null, // $2
      destination.trim(), // $3
      numRating, // $4
      title.trim(), // $5
      review_text.trim(), // $6
      processedImages, // $7 - NULL or JSON string
      travel_date || null, // $8
      trip_duration ? Number(trip_duration) : null, // $9
      budget_spent ? Number(budget_spent) : null, // $10
      travel_style || null, // $11
      processedHighlights, // $12 - NULL or JSON string
      tips ? tips.trim() : null, // $13
      would_recommend !== false, // $14
      is_public !== false, // $15
    ]

    console.log("💾 Prepared values for insertion:")
    values.forEach((value, index) => {
      const displayValue = typeof value === "string" && value.length > 50 ? value.substring(0, 50) + "..." : value
      console.log(`  $${index + 1}: ${displayValue} (${typeof value})`)
    })

    // Insert query - let PostgreSQL handle default values
    const insertQuery = `
      INSERT INTO reviews (
        user_id, trip_id, destination, rating, title, review_text,
        images, travel_date, trip_duration, budget_spent, travel_style,
        highlights, tips, would_recommend, is_public, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      RETURNING *
    `

    console.log("🔍 Executing insert query...")
    const result = await pool.query(insertQuery, values)
    const newReview = result.rows[0]

    console.log("✅ Review inserted successfully with ID:", newReview.id)

    // Parse JSON fields for response - handle NULL values
    try {
      if (newReview.images && newReview.images !== null) {
        newReview.images = JSON.parse(newReview.images)
      } else {
        newReview.images = []
      }

      if (newReview.highlights && newReview.highlights !== null) {
        newReview.highlights = JSON.parse(newReview.highlights)
      } else {
        newReview.highlights = []
      }
    } catch (parseError) {
      console.warn("⚠️ Error parsing JSON fields:", parseError.message)
      newReview.images = []
      newReview.highlights = []
    }

    console.log("🎉 Review creation completed successfully!")
    console.log("🚀 === REVIEW CREATION END ===")

    res.status(201).json({
      success: true,
      message: "Review created successfully! 🎉",
      review: newReview,
    })
  } catch (error) {
    console.error("🚀 === REVIEW CREATION ERROR ===")
    console.error("❌ Error message:", error.message)
    console.error("❌ Error code:", error.code)
    console.error("❌ Error detail:", error.detail)
    console.error("❌ Error constraint:", error.constraint)
    console.error("🚀 === REVIEW CREATION ERROR END ===")

    // Handle specific database errors
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this trip",
      })
    }

    if (error.code === "23503") {
      return res.status(400).json({
        success: false,
        message: "Invalid reference - user or trip not found",
      })
    }

    if (error.code === "42P01") {
      return res.status(500).json({
        success: false,
        message: "Database not properly initialized. Reviews table missing.",
      })
    }

    if (error.code === "42703") {
      return res.status(500).json({
        success: false,
        message: "Database schema mismatch. Missing column.",
      })
    }

    if (error.code === "22P02") {
      // Invalid input syntax for array
      console.error("❌ Array syntax error - this should be fixed now")
      return res.status(400).json({
        success: false,
        message: "Invalid data format. Please try again.",
      })
    }

    res.status(500).json({
      success: false,
      message: "Failed to create review. Please try again.",
      error:
        process.env.NODE_ENV === "development"
          ? {
              message: error.message,
              code: error.code,
              detail: error.detail,
            }
          : undefined,
    })
  }
}

// Get all public reviews with filters
export const getPublicReviews = async (req, res) => {
  try {
    const {
      destination,
      rating,
      travel_style,
      sort_by = "created_at",
      sort_order = "DESC",
      limit = 20,
      offset = 0,
    } = req.query

    console.log("📖 Fetching public reviews with filters:", {
      destination,
      rating,
      travel_style,
      sort_by,
      limit,
    })

    const whereConditions = ["r.is_public = true"]
    const queryParams = []
    let paramCount = 0

    // Add filters
    if (destination) {
      paramCount++
      whereConditions.push(`LOWER(r.destination) LIKE LOWER($${paramCount})`)
      queryParams.push(`%${destination}%`)
    }

    if (rating) {
      paramCount++
      whereConditions.push(`r.rating = $${paramCount}`)
      queryParams.push(Number.parseInt(rating))
    }

    if (travel_style) {
      paramCount++
      whereConditions.push(`LOWER(r.travel_style) = LOWER($${paramCount})`)
      queryParams.push(travel_style)
    }

    // Validate sort parameters
    const validSortFields = ["created_at", "rating", "helpful_count", "destination"]
    const validSortOrders = ["ASC", "DESC"]

    const sortField = validSortFields.includes(sort_by) ? sort_by : "created_at"
    const sortOrderValue = validSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : "DESC"

    const query = `
      SELECT 
        r.*,
        u.name as user_name,
        u.avatar_url as user_avatar,
        COALESCE(v.helpful_votes, 0) as helpful_votes
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN (
        SELECT review_id, COUNT(*) as helpful_votes
        FROM review_votes
        WHERE is_helpful = true
        GROUP BY review_id
      ) v ON r.id = v.review_id
      WHERE ${whereConditions.join(" AND ")}
      ORDER BY r.${sortField} ${sortOrderValue}
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `

    queryParams.push(Number.parseInt(limit), Number.parseInt(offset))

    const result = await pool.query(query, queryParams)

    // Parse JSON fields - handle NULL values
    const reviews = result.rows.map((review) => {
      if (review.images && review.images !== null) {
        try {
          review.images = JSON.parse(review.images)
        } catch (e) {
          review.images = []
        }
      } else {
        review.images = []
      }

      if (review.highlights && review.highlights !== null) {
        try {
          review.highlights = JSON.parse(review.highlights)
        } catch (e) {
          review.highlights = []
        }
      } else {
        review.highlights = []
      }
      return review
    })

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM reviews r
      WHERE ${whereConditions.join(" AND ")}
    `

    const countResult = await pool.query(countQuery, queryParams.slice(0, -2))
    const totalReviews = Number.parseInt(countResult.rows[0].total)

    console.log(`✅ Found ${reviews.length} reviews (${totalReviews} total)`)

    res.json({
      success: true,
      reviews: reviews,
      pagination: {
        total: totalReviews,
        limit: Number.parseInt(limit),
        offset: Number.parseInt(offset),
        hasMore: Number.parseInt(offset) + Number.parseInt(limit) < totalReviews,
      },
    })
  } catch (error) {
    console.error("❌ Error fetching reviews:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch reviews",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Get user's reviews
export const getUserReviews = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?.user_id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    console.log("📖 Fetching reviews for user:", userId)

    const query = `
      SELECT r.*, u.name as user_name, u.avatar_url as user_avatar
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
    `

    const result = await pool.query(query, [userId])

    // Parse JSON fields - handle NULL values
    const reviews = result.rows.map((review) => {
      if (review.images && review.images !== null) {
        try {
          review.images = JSON.parse(review.images)
        } catch (e) {
          review.images = []
        }
      } else {
        review.images = []
      }

      if (review.highlights && review.highlights !== null) {
        try {
          review.highlights = JSON.parse(review.highlights)
        } catch (e) {
          review.highlights = []
        }
      } else {
        review.highlights = []
      }
      return review
    })

    console.log(`✅ Found ${reviews.length} reviews for user ${userId}`)

    res.json({
      success: true,
      reviews: reviews,
    })
  } catch (error) {
    console.error("❌ Error fetching user reviews:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch user reviews",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Get review by ID
export const getReviewById = async (req, res) => {
  try {
    const { id } = req.params

    console.log("📖 Fetching review:", id)

    const query = `
      SELECT 
        r.*,
        u.name as user_name,
        u.avatar_url as user_avatar,
        COALESCE(v.helpful_votes, 0) as helpful_votes
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN (
        SELECT review_id, COUNT(*) as helpful_votes
        FROM review_votes
        WHERE is_helpful = true
        GROUP BY review_id
      ) v ON r.id = v.review_id
      WHERE r.id = $1
    `

    const result = await pool.query(query, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      })
    }

    const review = result.rows[0]

    // Parse JSON fields - handle NULL values
    if (review.images && review.images !== null) {
      try {
        review.images = JSON.parse(review.images)
      } catch (e) {
        review.images = []
      }
    } else {
      review.images = []
    }

    if (review.highlights && review.highlights !== null) {
      try {
        review.highlights = JSON.parse(review.highlights)
      } catch (e) {
        review.highlights = []
      }
    } else {
      review.highlights = []
    }

    console.log("✅ Review found:", review.title)

    res.json({
      success: true,
      review: review,
    })
  } catch (error) {
    console.error("❌ Error fetching review:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch review",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Vote on review helpfulness
export const voteOnReview = async (req, res) => {
  try {
    const { id } = req.params
    const { is_helpful } = req.body
    const userId = req.user?.userId || req.user?.id || req.user?.user_id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    console.log("👍 Voting on review:", { reviewId: id, userId, is_helpful })

    // Check if user already voted
    const existingVote = await pool.query("SELECT * FROM review_votes WHERE review_id = $1 AND user_id = $2", [
      id,
      userId,
    ])

    if (existingVote.rows.length > 0) {
      // Update existing vote
      await pool.query(
        "UPDATE review_votes SET is_helpful = $1, updated_at = NOW() WHERE review_id = $2 AND user_id = $3",
        [is_helpful, id, userId],
      )
    } else {
      // Insert new vote
      await pool.query("INSERT INTO review_votes (review_id, user_id, is_helpful) VALUES ($1, $2, $3)", [
        id,
        userId,
        is_helpful,
      ])
    }

    // Update helpful count in reviews table
    const countResult = await pool.query(
      "SELECT COUNT(*) as count FROM review_votes WHERE review_id = $1 AND is_helpful = true",
      [id],
    )

    await pool.query("UPDATE reviews SET helpful_count = $1, updated_at = NOW() WHERE id = $2", [
      countResult.rows[0].count,
      id,
    ])

    console.log("✅ Vote recorded successfully")

    res.json({
      success: true,
      message: "Vote recorded successfully",
    })
  } catch (error) {
    console.error("❌ Error voting on review:", error)
    res.status(500).json({
      success: false,
      message: "Failed to record vote",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Add review to favorites
export const addToFavorites = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user?.userId || req.user?.id || req.user?.user_id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    console.log("❤️ Adding review to favorites:", { reviewId: id, userId })

    // Check if review exists
    const reviewCheck = await pool.query("SELECT id FROM reviews WHERE id = $1", [id])
    if (reviewCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      })
    }

    // Check if already favorited
    const existingFavorite = await pool.query("SELECT * FROM review_favorites WHERE review_id = $1 AND user_id = $2", [
      id,
      userId,
    ])

    if (existingFavorite.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Review already in favorites",
      })
    }

    // Add to favorites
    await pool.query("INSERT INTO review_favorites (review_id, user_id, created_at) VALUES ($1, $2, NOW())", [
      id,
      userId,
    ])

    console.log("✅ Review added to favorites successfully")

    res.json({
      success: true,
      message: "Review added to favorites",
    })
  } catch (error) {
    console.error("❌ Error adding to favorites:", error)
    res.status(500).json({
      success: false,
      message: "Failed to add to favorites",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Remove review from favorites
export const removeFromFavorites = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user?.userId || req.user?.id || req.user?.user_id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    console.log("💔 Removing review from favorites:", { reviewId: id, userId })

    // Remove from favorites
    const result = await pool.query("DELETE FROM review_favorites WHERE review_id = $1 AND user_id = $2 RETURNING *", [
      id,
      userId,
    ])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Review not found in favorites",
      })
    }

    console.log("✅ Review removed from favorites successfully")

    res.json({
      success: true,
      message: "Review removed from favorites",
    })
  } catch (error) {
    console.error("❌ Error removing from favorites:", error)
    res.status(500).json({
      success: false,
      message: "Failed to remove from favorites",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Get user's favorite reviews
export const getUserFavorites = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?.user_id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    console.log("📖 Fetching favorite reviews for user:", userId)

    const query = `
      SELECT 
        r.*,
        u.name as user_name,
        u.avatar_url as user_avatar,
        rf.created_at as favorited_at,
        COALESCE(v.helpful_votes, 0) as helpful_votes
      FROM review_favorites rf
      JOIN reviews r ON rf.review_id = r.id
      JOIN users u ON r.user_id = u.id
      LEFT JOIN (
        SELECT review_id, COUNT(*) as helpful_votes
        FROM review_votes
        WHERE is_helpful = true
        GROUP BY review_id
      ) v ON r.id = v.review_id
      WHERE rf.user_id = $1
      ORDER BY rf.created_at DESC
    `

    const result = await pool.query(query, [userId])

    // Parse JSON fields - handle NULL values
    const favorites = result.rows.map((review) => {
      if (review.images && review.images !== null) {
        try {
          review.images = JSON.parse(review.images)
        } catch (e) {
          review.images = []
        }
      } else {
        review.images = []
      }

      if (review.highlights && review.highlights !== null) {
        try {
          review.highlights = JSON.parse(review.highlights)
        } catch (e) {
          review.highlights = []
        }
      } else {
        review.highlights = []
      }
      return review
    })

    console.log(`✅ Found ${favorites.length} favorite reviews for user ${userId}`)

    res.json({
      success: true,
      favorites: favorites,
    })
  } catch (error) {
    console.error("❌ Error fetching user favorites:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch favorite reviews",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Check if reviews are favorited by user
export const checkFavoriteStatus = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?.user_id
    const { reviewIds } = req.body

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    if (!reviewIds || !Array.isArray(reviewIds)) {
      return res.status(400).json({
        success: false,
        message: "Review IDs array is required",
      })
    }

    console.log("🔍 Checking favorite status for reviews:", { userId, reviewIds })

    const query = `
      SELECT review_id
      FROM review_favorites
      WHERE user_id = $1 AND review_id = ANY($2)
    `

    const result = await pool.query(query, [userId, reviewIds])
    const favoriteIds = result.rows.map((row) => row.review_id)

    res.json({
      success: true,
      favoriteIds: favoriteIds,
    })
  } catch (error) {
    console.error("❌ Error checking favorite status:", error)
    res.status(500).json({
      success: false,
      message: "Failed to check favorite status",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Get destinations with review counts
export const getDestinationsWithReviews = async (req, res) => {
  try {
    console.log("🗺️ Fetching destinations with review counts")

    const query = `
      SELECT 
        destination,
        COUNT(*) as review_count,
        AVG(rating)::NUMERIC(3,2) as average_rating,
        MAX(created_at) as latest_review
      FROM reviews
      WHERE is_public = true
      GROUP BY destination
      HAVING COUNT(*) > 0
      ORDER BY review_count DESC, average_rating DESC
      LIMIT 50
    `

    const result = await pool.query(query)

    console.log(`✅ Found ${result.rows.length} destinations with reviews`)

    res.json({
      success: true,
      destinations: result.rows,
    })
  } catch (error) {
    console.error("❌ Error fetching destinations:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch destinations",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Update review
export const updateReview = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user?.userId || req.user?.id || req.user?.user_id
    const updateData = req.body

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    console.log("📝 Updating review:", id)

    // Check if review belongs to user
    const reviewCheck = await pool.query("SELECT * FROM reviews WHERE id = $1 AND user_id = $2", [id, userId])

    if (reviewCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Review not found or unauthorized",
      })
    }

    // Build update query dynamically
    const allowedFields = [
      "destination",
      "rating",
      "title",
      "review_text",
      "images",
      "travel_date",
      "trip_duration",
      "budget_spent",
      "travel_style",
      "highlights",
      "tips",
      "would_recommend",
      "is_public",
    ]

    const updateFields = []
    const values = []
    let paramCount = 0

    Object.keys(updateData).forEach((key) => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        paramCount++
        updateFields.push(`${key} = $${paramCount}`)

        // Handle JSON fields - use NULL for empty arrays
        if (key === "images" || key === "highlights") {
          if (updateData[key] && Array.isArray(updateData[key]) && updateData[key].length > 0) {
            values.push(JSON.stringify(updateData[key]))
          } else {
            values.push(null)
          }
        } else {
          values.push(updateData[key])
        }
      }
    })

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      })
    }

    values.push(id)
    const updateQuery = `
      UPDATE reviews 
      SET ${updateFields.join(", ")}, updated_at = NOW()
      WHERE id = $${paramCount + 1}
      RETURNING *
    `

    const result = await pool.query(updateQuery, values)
    const updatedReview = result.rows[0]

    // Parse JSON fields for response - handle NULL values
    if (updatedReview.images && updatedReview.images !== null) {
      try {
        updatedReview.images = JSON.parse(updatedReview.images)
      } catch (e) {
        updatedReview.images = []
      }
    } else {
      updatedReview.images = []
    }

    if (updatedReview.highlights && updatedReview.highlights !== null) {
      try {
        updatedReview.highlights = JSON.parse(updatedReview.highlights)
      } catch (e) {
        updatedReview.highlights = []
      }
    } else {
      updatedReview.highlights = []
    }

    console.log("✅ Review updated successfully")

    res.json({
      success: true,
      message: "Review updated successfully",
      review: updatedReview,
    })
  } catch (error) {
    console.error("❌ Error updating review:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update review",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Delete review
export const deleteReview = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user?.userId || req.user?.id || req.user?.user_id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    console.log("🗑️ Deleting review:", id)

    // Check if review belongs to user
    const result = await pool.query("DELETE FROM reviews WHERE id = $1 AND user_id = $2 RETURNING *", [id, userId])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Review not found or unauthorized",
      })
    }

    console.log("✅ Review deleted successfully")

    res.json({
      success: true,
      message: "Review deleted successfully",
    })
  } catch (error) {
    console.error("❌ Error deleting review:", error)
    res.status(500).json({
      success: false,
      message: "Failed to delete review",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Get rating for a specific trip
export const getTripRating = async (req, res) => {
  try {
    const { tripId } = req.params

    console.log("📊 Fetching rating for trip:", tripId)

    const query = `
      SELECT 
        AVG(rating)::NUMERIC(3,2) as average_rating,
        COUNT(*) as review_count
      FROM reviews 
      WHERE trip_id = $1 AND is_public = true
    `

    const result = await pool.query(query, [tripId])
    const ratingData = result.rows[0]

    res.json({
      success: true,
      tripId: tripId,
      averageRating: ratingData.average_rating ? Number.parseFloat(ratingData.average_rating) : null,
      reviewCount: Number.parseInt(ratingData.review_count),
    })
  } catch (error) {
    console.error("❌ Error fetching trip rating:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch trip rating",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

// Get trip ratings for user's trips
export const getUserTripRatings = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?.user_id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      })
    }

    const query = `
      SELECT trip_id, rating 
      FROM reviews 
      WHERE user_id = $1 AND trip_id IS NOT NULL
    `

    const result = await pool.query(query, [userId])

    res.json({
      success: true,
      ratings: result.rows,
    })
  } catch (error) {
    console.error("❌ Error fetching user trip ratings:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch trip ratings",
    })
  }
}
