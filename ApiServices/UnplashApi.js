import dotenv from "dotenv"

dotenv.config()

class UnsplashService {
  constructor() {
    this.accessKey = process.env.UNSPLASH_ACCESS_KEY
    this.baseUrl = "https://api.unsplash.com"

    console.log("🖼️ Initializing Enhanced Unsplash Service...")
    console.log("Access Key:", this.accessKey ? "✅ Found" : "❌ Missing")

    if (!this.accessKey) {
      console.error("❌ UNSPLASH_ACCESS_KEY not found in environment variables")
    } else {
      console.log("✅ Unsplash Service initialized successfully")
    }
  }

  // Test API connection
  async testConnection() {
    try {
      console.log("🧪 Testing Unsplash API connection...")

      const response = await fetch(`${this.baseUrl}/photos/random?query=test`, {
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
          "Accept-Version": "v1",
        },
      })

      console.log("API Response Status:", response.status)
      console.log("Rate Limit Remaining:", response.headers.get("X-Ratelimit-Remaining"))

      if (!response.ok) {
        const errorText = await response.text()
        console.error("❌ Unsplash API Error:", response.status, errorText)
        return false
      }

      const data = await response.json()
      console.log("✅ Unsplash API connection successful")
      return true
    } catch (error) {
      console.error("❌ Unsplash API connection failed:", error)
      return false
    }
  }

  // Generate optimized search query for destinations
  generateDestinationQuery(destination) {
    const cleanDestination = destination.toLowerCase().trim()

    // Create multiple search terms for better results
    const searchTerms = [
      cleanDestination,
      `${cleanDestination} landmark`,
      `${cleanDestination} tourism`,
      `${cleanDestination} travel`,
      `${cleanDestination} destination`,
      `${cleanDestination} architecture`,
      `${cleanDestination} cityscape`,
    ]

    // Return the primary destination name for search
    return cleanDestination
  }

  // Get destination-specific images using search endpoint
  async getDestinationImage(destination, width = 1600, height = 900) {
    console.log(`🔍 Searching for destination images: ${destination}`)

    if (!this.accessKey) {
      console.error("❌ No Unsplash access key available")
      return this.getFallbackImage(destination, width, height)
    }

    try {
      const query = this.generateDestinationQuery(destination)

      // Use search/photos endpoint for more accurate results
      const searchUrl = `${this.baseUrl}/search/photos?query=${encodeURIComponent(query)}&page=1&per_page=10&orientation=landscape&order_by=relevant`

      console.log("📡 Searching for images with URL:", searchUrl)

      const response = await fetch(searchUrl, {
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
          "Accept-Version": "v1",
        },
      })

      console.log("📡 Search API Response Status:", response.status)
      console.log("📡 Rate Limit Remaining:", response.headers.get("X-Ratelimit-Remaining"))

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`❌ Unsplash search error for ${destination}:`, response.status, errorText)
        return this.getFallbackImage(destination, width, height)
      }

      const searchData = await response.json()
      console.log(`📊 Found ${searchData.total} images for "${destination}"`)

      if (searchData.results && searchData.results.length > 0) {
        // Get the most relevant image (first result)
        const photo = searchData.results[0]

        console.log("✅ Selected image:")
        console.log(`   ID: ${photo.id}`)
        console.log(`   Description: ${photo.description || photo.alt_description}`)
        console.log(`   Photographer: ${photo.user.name}`)
        console.log(`   URL: ${photo.urls.regular}`)

        // Trigger download tracking
        if (photo.links?.download_location) {
          await this.triggerDownload(photo.links.download_location)
        }

        return {
          url: photo.urls.regular,
          downloadUrl: photo.urls.full,
          smallUrl: photo.urls.small,
          thumbUrl: photo.urls.thumb,
          photographer: photo.user.name,
          photographerUrl: photo.user.links.html,
          description: photo.description || photo.alt_description || `Beautiful view of ${destination}`,
          downloadLocation: photo.links.download_location,
          unsplashId: photo.id,
          likes: photo.likes,
          color: photo.color,
        }
      } else {
        console.log(`⚠️ No search results found for "${destination}", trying random image...`)
        return await this.getRandomDestinationImage(destination, width, height)
      }
    } catch (error) {
      console.error(`❌ Error searching for images of ${destination}:`, error)
      return this.getFallbackImage(destination, width, height)
    }
  }

  // Fallback to random image if search fails
  async getRandomDestinationImage(destination, width = 1600, height = 900) {
    try {
      const query = this.generateDestinationQuery(destination)
      const randomUrl = `${this.baseUrl}/photos/random?query=${encodeURIComponent(query)}&orientation=landscape`

      console.log("🎲 Trying random image for:", destination)

      const response = await fetch(randomUrl, {
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
          "Accept-Version": "v1",
        },
      })

      if (!response.ok) {
        return this.getFallbackImage(destination, width, height)
      }

      const photo = await response.json()
      console.log("✅ Got random image for:", destination)

      return {
        url: photo.urls.regular,
        downloadUrl: photo.urls.full,
        smallUrl: photo.urls.small,
        thumbUrl: photo.urls.thumb,
        photographer: photo.user.name,
        photographerUrl: photo.user.links.html,
        description: photo.description || photo.alt_description || `Beautiful view of ${destination}`,
        downloadLocation: photo.links.download_location,
        unsplashId: photo.id,
        likes: photo.likes,
        color: photo.color,
      }
    } catch (error) {
      console.error("❌ Random image also failed:", error)
      return this.getFallbackImage(destination, width, height)
    }
  }

  // Get multiple destination images for gallery
  async getDestinationGallery(destination, count = 6) {
    console.log(`🖼️ Getting gallery of ${count} images for: ${destination}`)

    if (!this.accessKey) {
      return Array.from({ length: count }, (_, i) => this.getFallbackImage(destination, 800, 600))
    }

    try {
      const query = this.generateDestinationQuery(destination)
      const searchUrl = `${this.baseUrl}/search/photos?query=${encodeURIComponent(query)}&page=1&per_page=${count}&orientation=landscape&order_by=relevant`

      const response = await fetch(searchUrl, {
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
          "Accept-Version": "v1",
        },
      })

      if (!response.ok) {
        return Array.from({ length: count }, (_, i) => this.getFallbackImage(destination, 800, 600))
      }

      const searchData = await response.json()

      if (searchData.results && searchData.results.length > 0) {
        console.log(`✅ Found ${searchData.results.length} gallery images for: ${destination}`)

        return searchData.results.map((photo) => ({
          url: photo.urls.regular,
          downloadUrl: photo.urls.full,
          smallUrl: photo.urls.small,
          thumbUrl: photo.urls.thumb,
          photographer: photo.user.name,
          photographerUrl: photo.user.links.html,
          description: photo.description || photo.alt_description || `Beautiful view of ${destination}`,
          downloadLocation: photo.links.download_location,
          unsplashId: photo.id,
          likes: photo.likes,
          color: photo.color,
        }))
      } else {
        return Array.from({ length: count }, (_, i) => this.getFallbackImage(destination, 800, 600))
      }
    } catch (error) {
      console.error(`❌ Error getting gallery for ${destination}:`, error)
      return Array.from({ length: count }, (_, i) => this.getFallbackImage(destination, 800, 600))
    }
  }

  // Enhanced search with specific categories
  async searchDestinationByCategory(destination, category = "landmark") {
    const categoryQueries = {
      landmark: `${destination} landmark monument famous`,
      nature: `${destination} nature landscape scenic`,
      city: `${destination} city skyline urban architecture`,
      culture: `${destination} culture traditional heritage`,
      food: `${destination} food cuisine local restaurant`,
      beach: `${destination} beach ocean coast`,
      mountain: `${destination} mountain hill peak`,
      temple: `${destination} temple religious spiritual`,
    }

    const query = categoryQueries[category] || `${destination} ${category}`

    try {
      const searchUrl = `${this.baseUrl}/search/photos?query=${encodeURIComponent(query)}&page=1&per_page=5&orientation=landscape&order_by=relevant`

      const response = await fetch(searchUrl, {
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
          "Accept-Version": "v1",
        },
      })

      if (!response.ok) {
        return null
      }

      const searchData = await response.json()

      if (searchData.results && searchData.results.length > 0) {
        const photo = searchData.results[0]

        return {
          url: photo.urls.regular,
          downloadUrl: photo.urls.full,
          smallUrl: photo.urls.small,
          thumbUrl: photo.urls.thumb,
          photographer: photo.user.name,
          photographerUrl: photo.user.links.html,
          description: photo.description || photo.alt_description || `${category} in ${destination}`,
          downloadLocation: photo.links.download_location,
          unsplashId: photo.id,
          likes: photo.likes,
          color: photo.color,
          category: category,
        }
      }

      return null
    } catch (error) {
      console.error(`❌ Error searching ${category} for ${destination}:`, error)
      return null
    }
  }

  // Fallback image when API fails
  getFallbackImage(destination, width = 1600, height = 900) {
    console.log(`🔄 Using fallback image for: ${destination}`)

    const fallbackUrl = `https://source.unsplash.com/${width}x${height}/?${encodeURIComponent(destination)},travel,landmark`

    return {
      url: fallbackUrl,
      downloadUrl: fallbackUrl,
      smallUrl: `https://source.unsplash.com/400x300/?${encodeURIComponent(destination)},travel`,
      thumbUrl: `https://source.unsplash.com/200x150/?${encodeURIComponent(destination)},travel`,
      photographer: "Unsplash",
      photographerUrl: "https://unsplash.com",
      description: `Travel destination: ${destination}`,
      downloadLocation: null,
      unsplashId: null,
      likes: 0,
      color: "#cccccc",
    }
  }

  // Trigger download (required by Unsplash API guidelines)
  async triggerDownload(downloadLocation) {
    if (!downloadLocation || !this.accessKey) return

    try {
      console.log("📥 Triggering Unsplash download tracking...")
      await fetch(downloadLocation, {
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
        },
      })
      console.log("✅ Download tracking successful")
    } catch (error) {
      console.error("❌ Error triggering Unsplash download:", error)
    }
  }

  // Get API usage stats
  async getApiStats() {
    try {
      const response = await fetch(`${this.baseUrl}/me`, {
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
          "Accept-Version": "v1",
        },
      })

      return {
        rateLimit: response.headers.get("X-Ratelimit-Limit"),
        rateLimitRemaining: response.headers.get("X-Ratelimit-Remaining"),
        status: response.status,
      }
    } catch (error) {
      console.error("❌ Error getting API stats:", error)
      return null
    }
  }
}

export default new UnsplashService()
