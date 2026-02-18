'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Edit, Trash2, RefreshCw, LogOut, FileText, Search, Filter, X, Wand2, Download, Upload, ListMusic } from 'lucide-react'
import ShiurForm from './ShiurForm'
import { useToast } from './Toast'
import AdminStats from './AdminStats'

interface Shiur {
  id: string
  guid: string
  title: string
  description?: string | null
  blurb?: string | null
  audioUrl: string
  sourceDoc?: string | null
  sourcesJson?: string | null
  pubDate: string
  duration?: string | null
  link?: string | null
  status?: 'draft' | 'published' | 'scheduled' | null
  platformLinks?: {
    youtube?: string | null
    youtubeMusic?: string | null
    spotify?: string | null
    apple?: string | null
    amazon?: string | null
    pocket?: string | null
    twentyFourSix?: string | null
    castbox?: string | null
  } | null
}

export default function AdminDashboard() {
  const [shiurim, setShiurim] = useState<Shiur[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [editingShiur, setEditingShiur] = useState<Shiur | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)
  const [syncingYouTube, setSyncingYouTube] = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const bulkFileRef = React.useRef<HTMLInputElement>(null)
  const router = useRouter()
  const toast = useToast()

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | 'week' | 'month' | 'year'>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'has-sources' | 'no-sources'>('all')

  // Filter shiurim based on search and filters
  const filteredShiurim = shiurim.filter(shiur => {
    // Text search
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesTitle = shiur.title.toLowerCase().includes(query)
      const matchesDesc = shiur.description?.toLowerCase().includes(query)
      const matchesBlurb = shiur.blurb?.toLowerCase().includes(query)
      if (!matchesTitle && !matchesDesc && !matchesBlurb) return false
    }

    // Date filter
    if (dateFilter !== 'all') {
      const pubDate = new Date(shiur.pubDate)
      const now = new Date()
      const daysDiff = (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24)
      if (dateFilter === 'week' && daysDiff > 7) return false
      if (dateFilter === 'month' && daysDiff > 30) return false
      if (dateFilter === 'year' && daysDiff > 365) return false
    }

    // Source filter
    if (sourceFilter !== 'all') {
      const hasSources = !!(shiur.sourcesJson || shiur.sourceDoc)
      if (sourceFilter === 'has-sources' && !hasSources) return false
      if (sourceFilter === 'no-sources' && hasSources) return false
    }

    return true
  })

  const clearFilters = () => {
    setSearchQuery('')
    setDateFilter('all')
    setSourceFilter('all')
  }

  const hasActiveFilters = searchQuery || dateFilter !== 'all' || sourceFilter !== 'all'

  // Compute stats for AdminStats component
  const stats = {
    totalShiurim: shiurim.length,
    thisMonthCount: shiurim.filter(s => {
      const pubDate = new Date(s.pubDate)
      const now = new Date()
      return pubDate.getMonth() === now.getMonth() && pubDate.getFullYear() === now.getFullYear()
    }).length,
    withSources: shiurim.filter(s => s.sourcesJson || s.sourceDoc).length,
    missingLinks: shiurim.filter(s => {
      const links = s.platformLinks
      if (!links) return true
      const filledCount = [links.youtube, links.spotify, links.apple, links.amazon].filter(Boolean).length
      return filledCount < 2 // Consider "missing" if less than 2 main platforms
    }).length,
    drafts: shiurim.filter(s => s.status === 'draft').length
  }

  // Helper to count platform links for a shiur
  const getPlatformLinkCount = (shiur: Shiur) => {
    const links = shiur.platformLinks
    if (!links) return 0
    return [
      links.youtube,
      links.youtubeMusic,
      links.spotify,
      links.apple,
      links.amazon,
      links.pocket,
      links.twentyFourSix,
      links.castbox
    ].filter(Boolean).length
  }

  useEffect(() => {
    fetchShiurim()
  }, [])

  const fetchShiurim = async () => {
    try {
      const response = await fetch('/api/shiurim')
      const data = await response.json() as Shiur[]
      setShiurim(data)
    } catch (error) {
      console.error('Error fetching shiurim:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const response = await fetch('/api/rss/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await response.json() as { synced?: number; errors?: number; error?: string }

      if (response.ok) {
        toast.success(`Synced ${data.synced} shiurim`, data.errors ? `${data.errors} errors` : undefined)
        fetchShiurim()
      } else {
        toast.error('Error syncing RSS feed', data.error)
      }
    } catch (error) {
      toast.error('Error syncing RSS feed')
    } finally {
      setSyncing(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this shiur?')) return

    try {
      const response = await fetch(`/api/shiurim/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success('Shiur deleted')
        fetchShiurim()
      } else {
        toast.error('Error deleting shiur')
      }
    } catch (error) {
      toast.error('Error deleting shiur')
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/login', { method: 'DELETE' })
      router.push('/admin')
      router.refresh()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const handleDeleteSourceSheet = async (shiurId: string, type: 'clipped' | 'pdf' = 'clipped') => {
    try {
      const body = type === 'clipped'
        ? { sourcesJson: null }
        : { sourceDoc: null }

      const response = await fetch(`/api/shiurim/${shiurId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        toast.success(type === 'clipped' ? 'Clipped sources deleted' : 'PDF link removed')
        fetchShiurim()
      } else {
        toast.error('Error deleting')
      }
    } catch (error) {
      toast.error('Error deleting')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-primary">Admin Dashboard</h1>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/sources"
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
            >
              <FileText className="w-4 h-4" />
              Sources
            </Link>
            <Link
              href="/admin/analytics"
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
            >
              📊
              Analytics
            </Link>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync RSS'}
            </button>
            <Link
              href="/admin/playlists"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <ListMusic className="w-4 h-4" />
              Manage Playlists
            </Link>
            <button
              onClick={async () => {
                setAutoFilling(true)
                try {
                  const response = await fetch('/api/admin/auto-fill-links', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': 'Bearer admin'
                    },
                    body: JSON.stringify({ minSimilarity: 0.7 })
                  })
                  const data = await response.json() as {
                    success?: boolean;
                    error?: string;
                    summary?: { updated: number; processed: number }
                  }
                  if (data.success) {
                    toast.success(
                      'Auto-fill complete!',
                      `Updated ${data.summary?.updated ?? 0} of ${data.summary?.processed ?? 0} shiurim`
                    )
                    fetchShiurim() // Refresh the list
                  } else {
                    toast.error('Auto-fill failed', data.error || 'Unknown error')
                  }
                } catch (error: any) {
                  toast.error('Auto-fill failed', error.message)
                } finally {
                  setAutoFilling(false)
                }
              }}
              disabled={autoFilling}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              <Wand2 className={`w-4 h-4 ${autoFilling ? 'animate-pulse' : ''}`} />
              {autoFilling ? 'Filling...' : 'Auto-Fill Links'}
            </button>
            <a
              href="/api/admin/bulk-links"
              download="shiurim-links.csv"
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </a>
            <button
              onClick={() => setShowBulkImport(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Import Links
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Dashboard Stats */}
        <AdminStats
          totalShiurim={stats.totalShiurim}
          thisMonthCount={stats.thisMonthCount}
          withSources={stats.withSources}
          missingLinks={stats.missingLinks}
          drafts={stats.drafts}
        />

        {/* Search and Filters */}
        <div className="mb-6 bg-white rounded-lg shadow p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[250px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search shiurim..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            {/* Date Filter */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
            >
              <option value="all">All Time</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </select>

            {/* Source Filter */}
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
            >
              <option value="all">All Sources</option>
              <option value="has-sources">Has Sources</option>
              <option value="no-sources">Missing Sources</option>
            </select>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {hasActiveFilters
              ? `Showing ${filteredShiurim.length} of ${shiurim.length} Shiurim`
              : `All Shiurim (${shiurim.length})`
            }
          </h2>
          <button
            onClick={() => {
              setEditingShiur(null)
              setShowForm(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add New Shiur
          </button>
        </div>

        {showForm && !editingShiur && (
          <div className="mb-8">
            <ShiurForm
              shiur={null}
              onSuccess={() => {
                setShowForm(false)
                fetchShiurim()
              }}
              onCancel={() => {
                setShowForm(false)
              }}
            />
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Duration
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Source Sheet
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Links
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredShiurim.map((shiur) => (
                  <React.Fragment key={shiur.id}>
                    <tr className="hover:bg-gray-50 group">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-gray-900 max-w-md truncate">
                            {shiur.title}
                          </div>
                          {shiur.status === 'draft' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Draft</span>
                          )}
                          {/* Hover Edit Button */}
                          <button
                            onClick={() => {
                              setEditingShiur(shiur)
                              setShowForm(true)
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-primary hover:bg-primary/10 rounded transition-all"
                            title="Quick Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(shiur.pubDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {shiur.duration || 'N/A'}
                      </td>
                      {/* Source Sheet Status */}
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {/* Clipped Sources */}
                          {shiur.sourcesJson && (
                            <div className="flex items-center gap-1">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                📜 Clipped
                              </span>
                              <button
                                onClick={() => {
                                  if (confirm('Delete the clipped sources?')) {
                                    handleDeleteSourceSheet(shiur.id, 'clipped')
                                  }
                                }}
                                className="text-red-400 hover:text-red-600 p-0.5"
                                title="Delete clipped sources"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          {/* PDF URL */}
                          {shiur.sourceDoc && !shiur.sourceDoc.startsWith('sources:') && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              📄 PDF
                            </span>
                          )}
                          {/* None */}
                          {!shiur.sourcesJson && !shiur.sourceDoc && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                              None
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Platform Links Progress */}
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {(() => {
                          const count = getPlatformLinkCount(shiur)
                          const percentage = Math.round((count / 8) * 100)
                          const color = count >= 6 ? 'bg-green-500' : count >= 3 ? 'bg-yellow-500' : 'bg-red-400'
                          return (
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${color} transition-all`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 font-medium w-8">
                                {count}/8
                              </span>
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/admin/sources?shiurId=${shiur.id}`}
                            className="text-blue-600 hover:text-blue-800"
                            title="Edit Sources"
                          >
                            <FileText className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => {
                              setEditingShiur(shiur)
                              setShowForm(true)
                            }}
                            className="text-primary hover:text-primary/80"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(shiur.id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Inline Edit Form - shows below the selected row */}
                    {editingShiur?.id === shiur.id && showForm && (
                      <tr>
                        <td colSpan={7} className="px-4 py-4 bg-gray-50 border-t-2 border-primary">
                          <ShiurForm
                            shiur={editingShiur}
                            onSuccess={() => {
                              setShowForm(false)
                              setEditingShiur(null)
                              fetchShiurim()
                            }}
                            onCancel={() => {
                              setShowForm(false)
                              setEditingShiur(null)
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bulk Import Modal */}
      {showBulkImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Import Platform Links</h2>
              <button onClick={() => setShowBulkImport(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
                <p className="font-medium mb-2">📋 Instructions:</p>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>Click "Export CSV" to download all shiurim with current links</li>
                  <li>Open the CSV in Excel/Google Sheets</li>
                  <li>Fill in the platform URLs in the appropriate columns</li>
                  <li>Save as CSV and upload below</li>
                </ol>
                <p className="mt-2 text-xs">Columns: title, youtube, youtubeMusic, spotify, apple, amazon, pocket, castbox</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Upload CSV File</label>
                <input
                  ref={bulkFileRef}
                  type="file"
                  accept=".csv"
                  disabled={importing}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return

                    setImporting(true)
                    try {
                      const text = await file.text()
                      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

                      // Parse header
                      const parseCSVLine = (line: string): string[] => {
                        const result: string[] = []
                        let current = ''
                        let inQuotes = false
                        for (let i = 0; i < line.length; i++) {
                          const char = line[i]
                          if (char === '"') inQuotes = !inQuotes
                          else if (char === ',' && !inQuotes) {
                            result.push(current.replace(/^"|"$/g, '').trim())
                            current = ''
                          } else current += char
                        }
                        result.push(current.replace(/^"|"$/g, '').trim())
                        return result
                      }

                      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase())
                      const titleIdx = headers.indexOf('title')
                      if (titleIdx === -1) throw new Error('CSV must have a "title" column')

                      const rows = []
                      for (let i = 1; i < lines.length; i++) {
                        const cols = parseCSVLine(lines[i])
                        const row: Record<string, string> = { title: cols[titleIdx] || '' }

                        const platforms = ['youtube', 'youtubemusic', 'spotify', 'apple', 'amazon', 'pocket', 'castbox']
                        for (const p of platforms) {
                          const idx = headers.indexOf(p)
                          if (idx !== -1 && cols[idx]) {
                            row[p === 'youtubemusic' ? 'youtubeMusic' : p] = cols[idx]
                          }
                        }
                        if (row.title) rows.push(row)
                      }

                      const response = await fetch('/api/admin/bulk-links', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rows })
                      })

                      const result = await response.json() as { success?: boolean; summary?: { updated: number; created: number; notFound: number }; error?: string }

                      if (result.success) {
                        toast.success(
                          'Import complete!',
                          `Updated: ${result.summary?.updated}, Created: ${result.summary?.created}, Not found: ${result.summary?.notFound}`
                        )
                        setShowBulkImport(false)
                        fetchShiurim()
                      } else {
                        toast.error('Import failed', result.error || 'Unknown error')
                      }
                    } catch (error: any) {
                      toast.error('Import failed', error.message)
                    } finally {
                      setImporting(false)
                      if (bulkFileRef.current) bulkFileRef.current.value = ''
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-1 file:px-4 file:rounded file:border-0 file:bg-primary file:text-white file:cursor-pointer"
                />
              </div>

              {importing && (
                <div className="flex items-center gap-2 text-primary">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Importing...
                </div>
              )}

              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Quick Actions:</p>
                <button
                  onClick={async () => {
                    try {
                      const response = await fetch('/api/admin/fill-24six', { method: 'POST' })
                      const data = await response.json() as { success?: boolean; updated?: number; created?: number; error?: string }
                      if (data.success) {
                        toast.success('24Six set for all shiurim!', `Updated: ${data.updated}, Created: ${data.created}`)
                        fetchShiurim()
                      } else {
                        toast.error('Failed', data.error || 'Unknown error')
                      }
                    } catch (error: any) {
                      toast.error('Failed', error.message)
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Fill 24Six for All Shiurim
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div >
  )
}

