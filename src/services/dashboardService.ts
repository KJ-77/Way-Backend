import { executeQuery } from "../lib/db"

/**
 * Aggregate dashboard endpoint — fetches all dashboard data in a single API call.
 * Runs queries in parallel via Promise.all but shares the same DB connection pool,
 * so this uses 1–2 connections total, not one per query.
 *
 * See: Aggregate-API-Endpoint-Pattern in Obsidian vault.
 */
export const getDashboardData = async () => {
  const [
    clientStats,
    sessionStats,
    packageStats,
    recentSessions,
    upcomingSessions,
    packageDistribution,
  ] = await Promise.all([
    // Client stats
    executeQuery(`
      SELECT
        COUNT(*)::int AS total_clients,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_clients,
        COUNT(*) FILTER (WHERE loyalty = 'vip')::int AS vip_clients,
        COUNT(*) FILTER (WHERE first_visit >= date_trunc('month', CURRENT_DATE))::int AS new_this_month
      FROM users
    `),

    // Session stats
    executeQuery(`
      SELECT
        COUNT(*)::int AS total_sessions,
        COUNT(*) FILTER (WHERE date = CURRENT_DATE)::int AS today_sessions,
        COUNT(*) FILTER (WHERE attendance = 'present')::int AS present_count,
        COUNT(*) FILTER (WHERE attendance = 'absent')::int AS absent_count,
        COUNT(*) FILTER (WHERE attendance = 'late')::int AS late_count,
        COUNT(*) FILTER (WHERE attendance = 'cancelled')::int AS cancelled_count
      FROM sessions
    `),

    // Package stats
    executeQuery(`
      SELECT
        COUNT(*)::int AS total_packages,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_packages,
        COUNT(*) FILTER (WHERE status = 'expired')::int AS expired_packages,
        COUNT(*) FILTER (
          WHERE status = 'active'
          AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        )::int AS expiring_soon
      FROM packages
    `),

    // Recent sessions (for activity feed)
    executeQuery(`
      SELECT s.*, u.full_name AS client_name
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.date DESC, s.time DESC
      LIMIT 10
    `),

    // Upcoming sessions
    executeQuery(`
      SELECT s.*, u.full_name AS client_name
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.date >= CURRENT_DATE
      ORDER BY s.date ASC, s.time ASC
      LIMIT 6
    `),

    // Package distribution by type
    executeQuery(`
      SELECT package_type, COUNT(*)::int AS count
      FROM packages
      WHERE status = 'active'
      GROUP BY package_type
    `),
  ])

  return {
    clients: clientStats[0] ?? {},
    sessions: sessionStats[0] ?? {},
    packages: packageStats[0] ?? {},
    recentSessions,
    upcomingSessions,
    packageDistribution,
  }
}
