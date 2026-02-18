import { NextRequest, NextResponse } from 'next/server'
import { getDb, getD1Database } from '@/lib/db'
import { shiurim, platformLinks } from '@/lib/schema'
import { desc, eq, or, isNull } from 'drizzle-orm'
import { getParshaVariants } from '@/lib/parsha-utils'

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const parsha = searchParams.get('parsha')

        if (!parsha) {
            return NextResponse.json(
                { error: 'Missing parsha parameter' },
                { status: 400 }
            )
        }

        const d1 = await getD1Database()

        if (!d1) {
            return NextResponse.json(
                { error: 'Database not available' },
                { status: 500 }
            )
        }

        const db = getDb(d1)

        // Get all shiurim
        const allShiurim = await db
            .select()
            .from(shiurim)
            .where(or(eq(shiurim.status, 'published'), isNull(shiurim.status)))
            .orderBy(desc(shiurim.pubDate))
            .all()

        // Get all variants for the parsha (handles double parshas)
        const variants = getParshaVariants(parsha)

        // Filter shiurim that match any variant
        const matchingShiurim = allShiurim.filter(shiur => {
            const lowerTitle = shiur.title.toLowerCase()
            return variants.some(variant =>
                lowerTitle.includes(variant.toLowerCase())
            )
        }).slice(0, 6) // Limit to 6 results

        // Fetch platform links for each matching shiur
        const shiurimWithLinks = await Promise.all(
            matchingShiurim.map(async (shiur) => {
                const links = await db
                    .select()
                    .from(platformLinks)
                    .where(eq(platformLinks.shiurId, shiur.id))
                    .get()

                return {
                    ...shiur,
                    platformLinks: links || null,
                }
            })
        )

        return NextResponse.json({
            parsha,
            count: shiurimWithLinks.length,
            shiurim: shiurimWithLinks,
        })
    } catch (error) {
        console.error('Error fetching shiurim by parsha:', error)
        return NextResponse.json(
            { error: 'Failed to fetch shiurim' },
            { status: 500 }
        )
    }
}
