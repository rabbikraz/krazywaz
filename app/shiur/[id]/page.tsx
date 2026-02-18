import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { formatDate, formatDuration, extractYouTubeVideoId, getYouTubeThumbnail } from '@/lib/utils'
import PlatformLinks from '@/components/PlatformLinks'
import SourceSheetViewer from '@/components/SourceSheetViewer'
import StickyAudioPlayer from '@/components/StickyAudioPlayer'
import ViewCounter from '@/components/ViewCounter'
import Footer from '@/components/Footer'
import { getDb, getD1Database } from '@/lib/db'
import { shiurim, platformLinks } from '@/lib/schema'
import { eq, and, or, isNull } from 'drizzle-orm'

// Mark as dynamic to avoid build-time database access
export const dynamic = 'force-dynamic'
export const revalidate = 60

async function getShiur(id: string) {
  try {
    const d1 = await getD1Database()

    if (!d1) {
      console.error('D1 database not available')
      return null
    }

    const db = getDb(d1)

    const shiur = await db
      .select()
      .from(shiurim)
      .where(and(eq(shiurim.id, id), or(eq(shiurim.status, 'published'), isNull(shiurim.status))))
      .get()

    if (!shiur) {
      return null
    }

    // Fetch platform links
    const links = await db
      .select()
      .from(platformLinks)
      .where(eq(platformLinks.shiurId, id))
      .get()

    return {
      ...shiur,
      platformLinks: links || null,
      shouldRedirect: shiur.slug ? `/${shiur.slug}` : null, // Redirect to slug URL if exists
    }
  } catch (error) {
    console.error('Error fetching shiur:', error)
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const shiur = await getShiur(id) as any

  if (!shiur) {
    return {
      title: 'Shiur Not Found',
    }
  }

  // Use custom thumbnail first, then YouTube, then fallback
  const youtubeVideoId = extractYouTubeVideoId(shiur.platformLinks?.youtube || shiur.link)
  const thumbnailUrl = shiur.thumbnail || getYouTubeThumbnail(youtubeVideoId)

  return {
    title: `${shiur.title} — Rabbi Kraz's Shiurim`,
    description: shiur.blurb || shiur.description?.replace(/<[^>]*>/g, '').substring(0, 160) || 'Source sheet and audio for this powerful shiur by Rabbi Kraz',
    openGraph: {
      title: `${shiur.title} — Rabbi Kraz's Shiurim`,
      description: shiur.blurb || shiur.description?.replace(/<[^>]*>/g, '').substring(0, 160) || 'Source sheet and audio for this powerful shiur by Rabbi Kraz',
      images: thumbnailUrl ? [
        {
          url: thumbnailUrl,
          width: 1200,
          height: 630,
          alt: shiur.title,
        }
      ] : [],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${shiur.title} — Rabbi Kraz's Shiurim`,
      description: shiur.blurb || shiur.description?.replace(/<[^>]*>/g, '').substring(0, 160) || 'Source sheet and audio for this powerful shiur by Rabbi Kraz',
      images: thumbnailUrl ? [thumbnailUrl] : [],
    },
  }
}

export default async function ShiurPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const shiur = await getShiur(id) as any

  if (!shiur) {
    notFound()
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/50">
      {/* Compact Header for Mobile */}
      <header className="bg-primary text-white py-2 md:py-4">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between">
          <Link href="/" className="font-serif text-lg md:text-2xl font-semibold hover:text-blue-200 transition-colors">
            Rabbi Kraz's Shiurim
          </Link>
          <nav className="flex items-center gap-3 md:gap-6 text-xs md:text-sm">
            <Link href="/" className="hover:text-blue-200 transition-colors">Home</Link>
            <Link href="/archive" className="hover:text-blue-200 transition-colors">Archive</Link>
            <Link href="/sponsor" className="hover:text-blue-200 transition-colors">Sponsor</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-4 md:py-6 pb-32">
        {/* Title Section - Compact */}
        <div className="mb-4 md:mb-6">
          <h1 className="font-serif text-xl md:text-3xl font-bold text-primary mb-2 leading-tight">
            {shiur.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 md:gap-4 text-xs md:text-sm text-muted-foreground">
            <span>{formatDate(shiur.pubDate)}</span>
            {shiur.duration && (
              <>
                <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                <span>{formatDuration(shiur.duration)}</span>
              </>
            )}
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            <ViewCounter shiurId={shiur.id} />
          </div>
        </div>

        {/* Platform Icons - Full Width Centered */}
        {shiur.platformLinks && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 mb-4 md:mb-6">
            <h2 className="font-serif text-lg md:text-xl font-semibold text-primary mb-4 text-center">
              Listen Now
            </h2>
            <PlatformLinks links={shiur.platformLinks} title={shiur.title} />
          </div>
        )}

        {/* Blurb - Compact */}
        {shiur.blurb && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 mb-4 md:mb-6">
            <p className="text-sm md:text-base text-gray-700 leading-relaxed">{shiur.blurb}</p>
          </div>
        )}

        {/* Source Sheet - Main Focus */}
        {(shiur.sourceDoc || shiur.sourcesJson) && (
          <SourceSheetViewer
            sourceDoc={shiur.sourceDoc}
            sourcesJson={shiur.sourcesJson}
            title={shiur.title}
          />
        )}

        {/* Thumbnail at bottom - auto-pull from YouTube or use manual */}
        {(() => {
          const youtubeVideoId = extractYouTubeVideoId(shiur.platformLinks?.youtube || shiur.link)
          const thumbnailUrl = shiur.thumbnail || getYouTubeThumbnail(youtubeVideoId)
          if (!thumbnailUrl) return null
          return (
            <div className="mt-4 md:mt-6 mb-8 md:mb-20">
              <img
                src={thumbnailUrl}
                alt={shiur.title}
                className="w-full max-w-2xl mx-auto rounded-xl shadow-md aspect-video object-cover"
              />
            </div>
          )
        })()}
      </main>

      <Footer withStickyPlayer />

      {/* Sticky Audio Player - Fixed at Bottom */}
      <StickyAudioPlayer shiur={shiur} />
    </div>
  )
}
