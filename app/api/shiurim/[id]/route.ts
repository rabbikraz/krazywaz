import { NextRequest, NextResponse } from 'next/server'
import { getDb, getD1Database } from '@/lib/db'
import { shiurim, platformLinks, users } from '@/lib/schema'
import { cookies } from 'next/headers'
import { eq, and, or, isNull } from 'drizzle-orm'

async function isAuthenticated(d1: D1Database) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin-session')
  if (!session) return false

  const db = getDb(d1)
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.value))
    .get()

  return !!user
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const d1 = await getD1Database()

    if (!d1) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      )
    }

    const db = getDb(d1)
    const isAdmin = await isAuthenticated(d1)

    const shiur = await db
      .select()
      .from(shiurim)
      .where(isAdmin
        ? eq(shiurim.id, id)
        : and(eq(shiurim.id, id), or(eq(shiurim.status, 'published'), isNull(shiurim.status)))
      )
      .get()

    if (!shiur) {
      return NextResponse.json({ error: 'Shiur not found' }, { status: 404 })
    }

    // Fetch platform links
    const links = await db
      .select()
      .from(platformLinks)
      .where(eq(platformLinks.shiurId, id))
      .get()

    return NextResponse.json({
      ...shiur,
      platformLinks: links || null,
    })
  } catch (error) {
    console.error('Error fetching shiur:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const d1 = await getD1Database()

    if (!d1) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      )
    }

    if (!(await isAuthenticated(d1))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as {
      title?: string
      slug?: string
      description?: string
      blurb?: string
      audioUrl?: string
      sourceDoc?: string | null
      sourcesJson?: string | null
      pubDate?: string
      duration?: string
      link?: string
      thumbnail?: string
      status?: 'draft' | 'published' | 'scheduled'
      platformLinks?: any
    }
    const data = body

    const db = getDb(d1)

    // Check if we're setting a new slug that should become the ID
    let newId = id
    if (data.slug && data.slug !== id) {
      newId = data.slug
    }

    // Build update data
    const updateData: any = {}
    if (data.title !== undefined) updateData.title = data.title
    updateData.slug = null // Slug column is always null if ID serves as the slug

    if (data.description !== undefined) updateData.description = data.description
    if (data.blurb !== undefined) updateData.blurb = data.blurb
    if (data.audioUrl !== undefined) updateData.audioUrl = data.audioUrl
    if (data.sourceDoc !== undefined) updateData.sourceDoc = data.sourceDoc
    if (data.sourcesJson !== undefined) updateData.sourcesJson = data.sourcesJson
    if (data.pubDate !== undefined) updateData.pubDate = new Date(data.pubDate)
    if (data.duration !== undefined) updateData.duration = data.duration
    if (data.link !== undefined) updateData.link = data.link
    if (data.thumbnail !== undefined) updateData.thumbnail = data.thumbnail || null
    if (data.status !== undefined) updateData.status = data.status
    updateData.updatedAt = new Date()

    let updatedShiur

    if (newId !== id) {
      // HANDLE ID CHANGE (Migrating to Slug ID)
      console.log(`[Migrate] Changing ID from ${id} to ${newId}`)

      try {
        // 1. Get current data before deletion
        const currentShiur = await db
          .select()
          .from(shiurim)
          .where(eq(shiurim.id, id))
          .get()

        if (!currentShiur) {
          return NextResponse.json({ error: 'Shiur not found' }, { status: 404 })
        }

        // 2. Get existing platform links (because cascade delete will wipe them)
        const currentLinks = await db
          .select()
          .from(platformLinks)
          .where(eq(platformLinks.shiurId, id))
          .get()

        // 3. Delete Old Record (Cascades to links) to free up the 'guid' unique constraint
        await db.delete(shiurim).where(eq(shiurim.id, id)).execute()

        // 4. Create NEW record with NEW ID
        await db.insert(shiurim).values({
          id: newId,
          guid: currentShiur.guid, // We can preserve GUID now that old record is gone
          slug: null,
          title: updateData.title ?? currentShiur.title,
          description: updateData.description ?? currentShiur.description,
          blurb: updateData.blurb ?? currentShiur.blurb,
          audioUrl: updateData.audioUrl ?? currentShiur.audioUrl,
          sourceDoc: updateData.sourceDoc ?? currentShiur.sourceDoc,
          sourcesJson: updateData.sourcesJson ?? currentShiur.sourcesJson,
          pubDate: updateData.pubDate ? new Date(updateData.pubDate) : new Date(currentShiur.pubDate),
          duration: updateData.duration ?? currentShiur.duration,
          link: updateData.link ?? currentShiur.link,
          thumbnail: updateData.thumbnail ?? currentShiur.thumbnail,
          status: updateData.status ?? currentShiur.status,
          createdAt: currentShiur.createdAt,
          updatedAt: new Date(),
        }).execute()

        // 5. Restore Platform Links with New ID
        if (currentLinks) {
          await db.insert(platformLinks).values({
            shiurId: newId,
            youtube: currentLinks.youtube,
            youtubeMusic: currentLinks.youtubeMusic,
            spotify: currentLinks.spotify,
            apple: currentLinks.apple,
            amazon: currentLinks.amazon,
            pocket: currentLinks.pocket,
            twentyFourSix: currentLinks.twentyFourSix,
            castbox: currentLinks.castbox,
            createdAt: currentLinks.createdAt,
            updatedAt: new Date(),
          }).execute()
        }

        updatedShiur = await db.select().from(shiurim).where(eq(shiurim.id, newId)).get()
      } catch (err) {
        console.error('[Migrate] Error during ID migration:', err);
        return NextResponse.json({ error: `Migration failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
      }

    } else {
      // NORMAL UPDATE (No ID change)
      updatedShiur = await db
        .update(shiurim)
        .set(updateData)
        .where(eq(shiurim.id, id))
        .returning()
        .get()
    }

    // Update or create platform links (Normal flow if ID didn't change, or update newly restored links)
    // If ID changed, we just restored them above, but we might have NEW data in `data.platformLinks` to apply.
    if (data.platformLinks) {
      const targetId = newId; // Use the valid ID (either old or new)

      const existingLinks = await db
        .select()
        .from(platformLinks)
        .where(eq(platformLinks.shiurId, targetId))
        .get()

      if (existingLinks) {
        await db
          .update(platformLinks)
          .set({
            ...data.platformLinks,
            updatedAt: new Date(),
          })
          .where(eq(platformLinks.shiurId, targetId))
          .execute()
      } else {
        await db
          .insert(platformLinks)
          .values({
            shiurId: targetId,
            ...data.platformLinks,
          })
          .execute()
      }
    }

    // Fetch the updated shiur with links
    const links = await db
      .select()
      .from(platformLinks)
      .where(eq(platformLinks.shiurId, newId))
      .get()

    return NextResponse.json({
      ...updatedShiur,
      newId: newId !== id ? newId : undefined, // Return new ID if changed so frontend can redirect
      platformLinks: links || null,
    })
  } catch (error) {
    console.error('Error updating shiur:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const d1 = await getD1Database()

    if (!d1) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      )
    }

    if (!(await isAuthenticated(d1))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = getDb(d1)

    await db.delete(shiurim).where(eq(shiurim.id, id)).execute()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting shiur:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
