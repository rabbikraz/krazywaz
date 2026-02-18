import { NextRequest, NextResponse } from 'next/server'
import { getDb, getD1Database } from '@/lib/db'

export async function GET(request: NextRequest) {
    try {
        const query = request.nextUrl.searchParams.get('q')?.trim()

        if (!query || query.length < 2) {
            return NextResponse.json({ results: [], query: '' })
        }

        const d1 = await getD1Database()
        if (!d1) {
            return NextResponse.json(
                { error: 'Database not available' },
                { status: 503 }
            )
        }

        const db = getDb(d1)

        // Escape special FTS5 characters and prepare search term
        // Add * for prefix matching (e.g., "dream" matches "dreams")
        const searchTerm = query
            .replace(/['"]/g, '') // Remove quotes
            .split(/\s+/)         // Split by whitespace
            .filter(Boolean)      // Remove empty strings
            .map(term => `"${term}"*`) // Wrap each term and add prefix wildcard
            .join(' ')            // Join with space (implicit AND)

        // Query FTS5 with ranking
        // bm25() returns negative values, more negative = better match
        const results = await d1.prepare(`
      SELECT 
        shiurim.id,
        shiurim.title,
        shiurim.slug,
        shiurim.blurb,
        shiurim.description,
        shiurim.pub_date as pubDate,
        shiurim.duration,
        shiurim.audio_url as audioUrl,
        bm25(shiurim_fts) as rank,
        snippet(shiurim_fts, 1, '<mark>', '</mark>', '...', 32) as titleSnippet,
        snippet(shiurim_fts, 2, '<mark>', '</mark>', '...', 48) as descSnippet
      FROM shiurim_fts
      JOIN shiurim ON shiurim.id = shiurim_fts.id
      WHERE shiurim_fts MATCH ? AND (shiurim.status = 'published' OR shiurim.status IS NULL)
      ORDER BY rank
      LIMIT 20
    `).bind(searchTerm).all()

        return NextResponse.json({
            results: results.results || [],
            query,
            count: results.results?.length || 0
        })
    } catch (error) {
        console.error('Search error:', error)

        // Handle FTS5 not being set up yet
        if (error instanceof Error && error.message.includes('no such table')) {
            return NextResponse.json(
                { error: 'Search index not ready. Please run the migration.' },
                { status: 503 }
            )
        }

        return NextResponse.json(
            { error: 'Search failed' },
            { status: 500 }
        )
    }
}
