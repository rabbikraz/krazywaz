import { NextRequest, NextResponse } from 'next/server'
import { getDb, getD1Database } from '@/lib/db'
import { cachedPlaylists, cachedVideos, shiurim } from '@/lib/schema'
import { eq, like, or, isNull } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface CachedVideoWithShiur {
    id: string
    title: string
    thumbnail: string | null
    duration: string | null
    position: number | null
    shiurId: string | null
    slug: string | null
}

// Normalize parsha name for matching
function normalizeForMatch(name: string): string {
    return name
        .toLowerCase()
        .replace(/['-]/g, '')
        .replace(/parashat?\s*/i, '')
        .replace(/^bo$/, 'bo ') // Prevent 'bo' from matching 'bamidbar'
        .trim()
}

// GET - Get videos for a specific parsha from cache
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const parshaName = searchParams.get('parsha')

        if (!parshaName) {
            return NextResponse.json({ error: 'Parsha name is required' }, { status: 400 })
        }

        const d1 = await getD1Database()
        if (!d1) {
            return NextResponse.json({ error: 'Database not available' }, { status: 500 })
        }
        const db = getDb(d1)

        // Get all cached playlists
        const allPlaylists = await db.select().from(cachedPlaylists).all()

        // Find matching playlist
        const normalizedParsha = normalizeForMatch(parshaName)
        const matchingPlaylist = allPlaylists.find(p => {
            const normalizedTitle = normalizeForMatch(p.title)
            return normalizedTitle.includes(normalizedParsha) || normalizedParsha.includes(normalizedTitle)
        })

        if (!matchingPlaylist) {
            return NextResponse.json({
                parsha: parshaName,
                playlistId: null,
                playlistTitle: null,
                playlistUrl: null,
                videos: []
            })
        }

        // Get videos for this playlist
        const videos = await db
            .select()
            .from(cachedVideos)
            .where(eq(cachedVideos.playlistId, matchingPlaylist.id))
            .all()

        // Get shiur slugs for videos that have a matching shiur
        const shiurIds = videos.filter(v => v.shiurId).map(v => v.shiurId!)
        const shiurSlugs = new Map<string, string>()

        if (shiurIds.length > 0) {
            const allShiurim = await db.select().from(shiurim).where(or(eq(shiurim.status, 'published'), isNull(shiurim.status))).all()
            for (const s of allShiurim) {
                if (shiurIds.includes(s.id) && s.slug) {
                    shiurSlugs.set(s.id, s.slug)
                }
            }
        }

        // Build response
        const videosWithSlug: CachedVideoWithShiur[] = videos
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map(v => ({
                id: v.videoId, // Use actual YT ID
                title: v.title,
                thumbnail: v.thumbnail,
                duration: v.duration,
                position: v.position,
                shiurId: v.shiurId,
                slug: v.shiurId ? shiurSlugs.get(v.shiurId) || null : null
            }))

        return NextResponse.json({
            parsha: parshaName,
            playlistId: matchingPlaylist.id,
            playlistTitle: matchingPlaylist.title,
            playlistUrl: matchingPlaylist.playlistUrl,
            videos: videosWithSlug
        })

    } catch (error: any) {
        console.error('Error fetching parsha videos:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
