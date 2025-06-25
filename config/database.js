import pkg from "pg"
import dotenv from "dotenv"
import path from "path" // path is still useful for other things, but not for reading init-database.sql
import { fileURLToPath } from "url"

dotenv.config()

const { Pool } = pkg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename) // __dirname is still useful for general pathing if needed later

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
})

// Test database connection
pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL database")
})

pool.on("error", (err) => {
  console.error("❌ Database connection error:", err)
})

// Removed executeSQLFile as the schema is now managed manually
// If you ever need to run SQL files programmatically again (e.g., migrations),
// you can uncomment or re-introduce this function.
/*
const executeSQLFile = async (filePath) => {
  try {
    const rawSQL = fs.readFileSync(filePath, "utf8");

    const blocks = [];
    let currentBlock = "";
    let inDoBlock = false;

    for (const line of rawSQL.split("\n")) {
      const trimmed = line.trim();

      if (trimmed.startsWith("DO $$")) {
        inDoBlock = true;
      }

      if (inDoBlock) {
        currentBlock += line + "\n";
        if (trimmed.endsWith("$$;") || trimmed.endsWith("$$")) {
          blocks.push(currentBlock.trim());
          currentBlock = "";
          inDoBlock = false;
        }
      } else if (trimmed !== "") {
        currentBlock += line + "\n";
        if (trimmed.endsWith(";")) {
          blocks.push(currentBlock.trim());
          currentBlock = "";
        }
      }
    }

    if (currentBlock.trim()) {
      blocks.push(currentBlock.trim());
    }

    for (const statement of blocks) {
      if (statement) {
        await pool.query(statement);
      }
    }

    console.log(`✅ Successfully executed SQL file: ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`❌ Error executing SQL file ${filePath}:`, error);
    throw error;
  }
};
*/

export const initializeDatabase = async () => {
  try {
    console.log("🚀 Starting database initialization (connection verification only)...")

    // We no longer execute the SQL file here, as it's assumed you've run it manually.
    // const sqlFilePath = path.join(__dirname, "../../Scripts/init-database.sql")
    // if (!fs.existsSync(sqlFilePath)) {
    //   throw new Error(`SQL initialization file not found: ${sqlFilePath}`)
    // }
    // await executeSQLFile(sqlFilePath) // THIS LINE IS REMOVED/COMMENTED OUT

    // Just verify the connection and get database info
    const testResult = await pool.query("SELECT NOW() as current_time, version() as db_version")
    console.log("✅ Database connection verified at:", testResult.rows[0].current_time)
    console.log("✅ Database version:", testResult.rows[0].db_version.split(" ")[0])

    console.log("✅ Database initialization completed successfully! (Schema assumed to be pre-applied)")
    return true
  } catch (error) {
    console.error("❌ Database initialization failed:", error)
    throw error
  }
}

// Auto-run when imported
initializeDatabase().catch((error) => {
  console.error("❌ Failed to initialize database on startup:", error)
  process.exit(1)
})

export default pool