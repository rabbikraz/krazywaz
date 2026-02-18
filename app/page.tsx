import Link from 'next/link'
import { formatDate, formatDuration, getShiurUrl } from '@/lib/utils'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import PlayButton from '@/components/PlayButton'
import PlatformGrid from '@/components/PlatformGrid'
import ParshaAccordion from '@/components/ParshaAccordion'
import ViewCounter from '@/components/ViewCounter'
import { Calendar, Clock, Info } from 'lucide-react'
import { getDb, getD1Database } from '@/lib/db'
import { shiurim, platformLinks } from '@/lib/schema'
import { desc, eq, or, isNull } from 'drizzle-orm'

// Mark as dynamic to avoid build-time database access
export const dynamic = 'force-dynamic'
export const revalidate = 60 // Revalidate every 60 seconds

async function getLatestShiurim() {
  try {
    const d1 = await getD1Database()

    if (!d1) {
      console.error('D1 database not available')
      return []
    }

    const db = getDb(d1)

    // Fetch latest 9 published shiurim directly from database
    const allShiurim = await db
      .select()
      .from(shiurim)
      .where(or(eq(shiurim.status, 'published'), isNull(shiurim.status)))
      .orderBy(desc(shiurim.pubDate))
      .limit(9)
      .all()

    // Fetch platform links for each shiur
    const shiurimWithLinks = await Promise.all(
      allShiurim.map(async (shiur) => {
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

    return shiurimWithLinks
  } catch (error) {
    console.error('Error fetching shiurim:', error)
    return []
  }
}

export default async function Home() {
  const latestShiurim = await getLatestShiurim()

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/50">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-12">
        <section className="mb-16">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl font-semibold text-primary mb-2">
              Listen Anywhere
            </h2>
            <p className="text-muted-foreground">Subscribe on your favorite platform</p>
          </div>
          <PlatformGrid />
        </section>

        {/* This Week's Parsha Section */}
        <section className="mb-16">
          <ParshaAccordion />
        </section>



        <section className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-serif text-3xl font-semibold text-primary">
              Latest Shiurim
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {latestShiurim.map((shiur: any) => (
              <div
                key={shiur.id}
                className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow border border-gray-100 overflow-hidden flex flex-col h-full group"
              >
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <h3 className="font-serif text-xl font-semibold text-primary line-clamp-2 group-hover:text-secondary transition-colors">
                      <Link href={getShiurUrl(shiur)}>{shiur.title}</Link>
                    </h3>
                  </div>
                  <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-4">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{formatDate(shiur.pubDate)}</span>
                    </div>
                    {shiur.duration && (
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{formatDuration(shiur.duration)}</span>
                      </div>
                    )}
                    <ViewCounter shiurId={shiur.id} showBreakdown={false} />
                  </div>
                  {shiur.blurb && (
                    <p className="text-sm text-gray-600 line-clamp-3 mb-4 flex-1">
                      {shiur.blurb}
                    </p>
                  )}
                  <div className="flex items-center justify-between pt-4 mt-auto border-t border-gray-50">
                    <PlayButton shiur={shiur} />
                    <Link
                      className="flex items-center gap-1 text-sm text-secondary hover:text-primary font-medium"
                      href={getShiurUrl(shiur)}
                    >
                      Details <Info className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-2xl mx-auto text-center bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
          <h2 className="font-serif text-2xl font-semibold text-primary mb-4">
            Join the WhatsApp Group
          </h2>
          <p className="text-gray-600 mb-6">
            Get the latest shiur updates, announcements, and live shiur links directly to your phone.
          </p>
          <a
            href="https://chat.whatsapp.com/BdUZM8mzvXuEpgS9MoGN9W"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-[#25D366] text-white rounded-full font-bold hover:bg-[#128C7E] transition-colors shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
          >
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-[#25D366] font-bold text-xs">
              WA
            </div>
            Join Group
          </a>
        </section>
      </main>
      <Footer />
    </div>
  )
}
