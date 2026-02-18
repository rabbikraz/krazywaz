'use client'

import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

// ============================================================================
// TYPES
// ============================================================================

interface Source {
    id: string
    pageIndex: number
    box: { x: number; y: number; width: number; height: number } | null
    polygon: Array<{ x: number; y: number }> | null
    rotation: number
    clippedImage: string | null
    name: string
    reference: string | null
    displaySize: number  // Percentage 25-100 for how big to show on shiur page
}

interface PageData {
    imageDataUrl: string
    width: number
    height: number
    imageElement: HTMLImageElement | null
}

interface Shiur {
    id: string
    title: string
    slug: string
    sourcesJson?: string | null
}

type AppState = 'upload' | 'processing' | 'editing' | 'preview'
type DrawMode = 'rectangle' | 'polygon'

// ============================================================================
// PDF TO IMAGES
// ============================================================================

async function convertPdfToImages(file: File): Promise<PageData[]> {
    const pdfjs = await import('pdfjs-dist')
    const pdfjsLib = pdfjs.default || pdfjs
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const pages: PageData[] = []

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum)
        const scale = 2
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport } as any).promise
        const dataUrl = canvas.toDataURL('image/png')
        const img = new Image()
        img.src = dataUrl
        await new Promise(resolve => { img.onload = resolve })
        pages.push({ imageDataUrl: dataUrl, width: viewport.width, height: viewport.height, imageElement: img })
    }
    return pages
}

async function convertImageToDataUrl(file: File): Promise<PageData> {
    return new Promise((resolve) => {
        const reader = new FileReader()
        const img = new Image()
        reader.onload = () => {
            img.onload = () => {
                resolve({ imageDataUrl: reader.result as string, width: img.width, height: img.height, imageElement: img })
            }
            img.src = reader.result as string
        }
        reader.readAsDataURL(file)
    })
}

// ============================================================================
// IMAGE UPLOAD HELPER
// ============================================================================

/**
 * Upload a base64 data URL image to R2 via /api/upload.
 * Returns the public URL (e.g. /api/media/images/...).
 */
async function uploadImageToR2(dataUrl: string, slug: string, sourceId: string): Promise<string> {
    // Convert base64 data URL to a Blob/File
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'png'
    const file = new File([blob], `source-${sourceId}.${ext}`, { type: blob.type || 'image/png' })

    const formData = new FormData()
    formData.append('file', file)
    formData.append('slug', `${slug}-source-${sourceId}`)

    const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
    })

    if (!uploadRes.ok) {
        const err = await uploadRes.json() as { error?: string }
        throw new Error(err.error || 'Failed to upload source image')
    }

    const data = await uploadRes.json() as { url: string }
    return data.url
}

// ============================================================================
// CLIPPING FUNCTION
// ============================================================================

function clipSourceImage(source: Source, page: PageData): string | null {
    if (!page?.imageElement) return null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    if (source.box) {
        const sx = (source.box.x / 100) * page.width
        const sy = (source.box.y / 100) * page.height
        const sw = (source.box.width / 100) * page.width
        const sh = (source.box.height / 100) * page.height
        const angle = (source.rotation * Math.PI) / 180
        const cos = Math.abs(Math.cos(angle))
        const sin = Math.abs(Math.sin(angle))
        const newW = sw * cos + sh * sin
        const newH = sw * sin + sh * cos
        canvas.width = newW
        canvas.height = newH
        ctx.save()
        ctx.translate(newW / 2, newH / 2)
        ctx.rotate(angle)
        ctx.drawImage(page.imageElement, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh)
        ctx.restore()
        return canvas.toDataURL('image/png')
    } else if (source.polygon && source.polygon.length >= 3) {
        const points = source.polygon.map(p => ({ x: (p.x / 100) * page.width, y: (p.y / 100) * page.height }))
        const minX = Math.min(...points.map(p => p.x))
        const maxX = Math.max(...points.map(p => p.x))
        const minY = Math.min(...points.map(p => p.y))
        const maxY = Math.max(...points.map(p => p.y))
        canvas.width = maxX - minX
        canvas.height = maxY - minY
        ctx.beginPath()
        ctx.moveTo(points[0].x - minX, points[0].y - minY)
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x - minX, points[i].y - minY)
        }
        ctx.closePath()
        ctx.clip()
        const angle = (source.rotation * Math.PI) / 180
        ctx.save()
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate(angle)
        ctx.translate(-canvas.width / 2, -canvas.height / 2)
        ctx.drawImage(page.imageElement, minX, minY, maxX - minX, maxY - minY, 0, 0, maxX - minX, maxY - minY)
        ctx.restore()
        return canvas.toDataURL('image/png')
    }
    return null
    return null
}

// Helper to rotate base64 image
async function rotateImage(base64: string, rotation: number): Promise<string> {
    if (rotation === 0) return base64
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')!

            const rad = (rotation * Math.PI) / 180
            const absCos = Math.abs(Math.cos(rad))
            const absSin = Math.abs(Math.sin(rad))

            // Calculate new bounding box
            const w = img.width * absCos + img.height * absSin
            const h = img.width * absSin + img.height * absCos

            canvas.width = w
            canvas.height = h

            ctx.translate(w / 2, h / 2)
            ctx.rotate(rad)
            ctx.drawImage(img, -img.width / 2, -img.height / 2)

            resolve(canvas.toDataURL('image/png'))
        }
        img.src = base64
    })
}

// Component to render preview with correct layout flow
function SourcePreviewImage({ src, rotation, alt, style, className }: { src: string, rotation: number, alt: string, style?: any, className?: string }) {
    const [rotatedSrc, setRotatedSrc] = useState(src)

    useEffect(() => {
        // Debounce slightly to avoid heavy canvas ops on every slider pixel
        const timer = setTimeout(() => {
            if (rotation === 0) {
                setRotatedSrc(src)
            } else {
                rotateImage(src, rotation).then(setRotatedSrc)
            }
        }, 50)
        return () => clearTimeout(timer)
    }, [src, rotation])

    return <img src={rotatedSrc} alt={alt} style={style} className={className} />
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SourceManager() {
    const searchParams = useSearchParams()
    const urlShiurId = searchParams.get('id') || searchParams.get('shiurId')

    // Current File State (Visual Canvas)
    const [pages, setPages] = useState<PageData[]>([])
    const [currentPageIndex, setCurrentPageIndex] = useState(0)
    const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)

    const [appState, setAppState] = useState<AppState>('upload')
    const [statusMessage, setStatusMessage] = useState('')
    const [error, setError] = useState<string | null>(null)

    // Sources List (Can include legacy ones not on current canvas)
    const [sources, setSources] = useState<Source[]>([])

    // Original PDF file(s) uploaded by the user (for uploading to R2 on save)
    const [uploadedPdfFiles, setUploadedPdfFiles] = useState<File[]>([])

    // Tools
    const [drawMode, setDrawMode] = useState<DrawMode>('rectangle')

    // Rectangle drawing
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
    const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null)

    // Polygon drawing
    const [polygonPoints, setPolygonPoints] = useState<Array<{ x: number; y: number }>>([])
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)

    // Editing (drag/resize)
    const [editMode, setEditMode] = useState<'none' | 'drag' | 'resize' | 'rotate'>('none')
    const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
    const [editStart, setEditStart] = useState<{ x: number; y: number; box?: { x: number; y: number; width: number; height: number }; rotation?: number } | null>(null)
    const [resizeHandle, setResizeHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | null>(null)

    // Shiur attachment
    const [shiurim, setShiurim] = useState<Shiur[]>([])
    const [selectedShiurId, setSelectedShiurId] = useState<string | null>(urlShiurId)
    const [loadingShiurim, setLoadingShiurim] = useState(false)

    // Identification / Search
    const [identifyingId, setIdentifyingId] = useState<string | null>(null)
    const [identifyResults, setIdentifyResults] = useState<Array<{ sourceName: string, sefariaRef: string, previewText: string }> | null>(null)
    const [identifyTargetId, setIdentifyTargetId] = useState<string | null>(null)

    const canvasRef = useRef<HTMLDivElement>(null)
    const imageRef = useRef<HTMLImageElement>(null)

    // Load shiurim list
    useEffect(() => {
        const loadShiurim = async () => {
            setLoadingShiurim(true)
            try {
                const res = await fetch('/api/shiurim')
                const data = await res.json()
                if (Array.isArray(data)) {
                    // Include sourcesJson so we can load existing work
                    setShiurim(data.map((s: any) => ({
                        id: s.id,
                        title: s.title,
                        slug: s.slug,
                        sourcesJson: s.sourcesJson
                    })))
                } else {
                    console.error('Unexpected shiurim response:', data)
                }
            } catch (e) {
                console.error('Failed to load shiurim:', e)
            }
            setLoadingShiurim(false)
        }
        loadShiurim()
    }, [])

    // Handle Shiur Selection -> Auto-load existing sources
    useEffect(() => {
        if (!selectedShiurId) return

        const shiur = shiurim.find(s => s.id === selectedShiurId)
        if (shiur?.sourcesJson) {
            try {
                // If we already have sources, maybe ask user? For now, we append/overwrite?
                // Logic: If user selects a new shiur, we should probably Clear current work and load the new one.
                // UNLESS user has "New" stuff.
                // Simpler: Just overwrite display with this Shiur's sources.
                // User can then "Add PDF" to append.

                const loaded = JSON.parse(shiur.sourcesJson) as Source[]
                if (Array.isArray(loaded)) {
                    // Mark as 'imported' implicitly because they likely won't match the empty 'pages' array
                    // if we haven't loaded the PDF.
                    // IMPORTANT: We must ensure IDs are unique if we merge later.
                    // But here we are Replacing.
                    setSources(loaded)
                    // If we have sources but no pages, go to Editing mode (Sidebar only view)
                    if (pages.length === 0) {
                        setAppState('editing')
                    }
                }
            } catch (e) {
                console.error('Failed to parse existing sources', e)
            }
        }
    }, [selectedShiurId, shiurim]) // Dependencies

    // Auto-generate clipped images (ONLY for sources on current canvas pages)
    useEffect(() => {
        const updated = sources.map(s => {
            // Only clip if we DON'T have a clip yet AND we have the page loaded
            if (!s.clippedImage && (s.box || s.polygon) && pages[s.pageIndex]) {
                const page = pages[s.pageIndex]
                if (page) return { ...s, clippedImage: clipSourceImage(s, page) }
            }
            return s
        })
        const hasChanges = updated.some((s, i) => s.clippedImage !== sources[i].clippedImage)
        if (hasChanges) setSources(updated)
    }, [sources, pages])

    // ============================================================================
    // FILE HANDLING - APPEND MODE
    // ============================================================================

    const handleFileUpload = async (file: File) => {
        setError(null)
        setAppState('processing')
        setStatusMessage('Loading file...')
        try {
            let pageData: PageData[]
            if (file.type === 'application/pdf') {
                setStatusMessage('Converting PDF...')
                pageData = await convertPdfToImages(file)
                setUploadedPdfFiles(prev => [...prev, file])
            } else {
                setStatusMessage('Loading image...')
                pageData = [await convertImageToDataUrl(file)]
            }

            // APPEND Logic:
            // 1. Determine new starting page index (current pages length)
            const startIndex = pages.length

            // 2. Append new pages to existing pages (Visual Stack)
            // Actually, stacking multiple PDFs vertically in the viewer is hard if we just use 'setPages'.
            // The canvas renderer usually renders 'currentPageIndex'.
            // If we just add pages, 'currentPageIndex' logic works if we let user navigate.
            // So: yes, append pages.
            setPages(prev => [...prev, ...pageData])

            setStatusMessage(`Analyzing ${pageData.length} page(s)...`)

            const newSources: Source[] = []
            for (let i = 0; i < pageData.length; i++) {
                setStatusMessage(`Analyzing page ${i + 1}...`)
                // pageData[i] corresponds to global index (startIndex + i)
                const globalPageIndex = startIndex + i

                // Note: analyzePageWithGemini needs to return sources with correct pageIndex?
                // Actually analyzePageWithGemini usually returns 0-based index for single page.
                // We need to offset it.
                const pageSources = await analyzePageWithGemini(pageData[i], globalPageIndex)
                newSources.push(...pageSources)
            }

            // Clip new sources immediately
            for (const source of newSources) {
                // pageIndex is global now.
                // pageData is the NEW batch. source.pageIndex refers to global 'pages' array.
                // To find the page image, we look at pageData[source.pageIndex - startIndex].
                const localPageIndex = source.pageIndex - startIndex
                if (pageData[localPageIndex]) {
                    source.clippedImage = clipSourceImage(source, pageData[localPageIndex])
                }
            }

            // Append new sources to existing
            setSources(prev => [...prev, ...newSources])

            setStatusMessage(newSources.length > 0 ? `Found ${newSources.length} new sources` : 'Draw sources manually')

            // Switch to the first NEW page
            setCurrentPageIndex(startIndex)
            setAppState('editing')

        } catch (err) {
            console.error(err)
            setError(String(err))
            // Only reset to upload if we have NO pages at all? default: stay in processing or go back
            if (pages.length === 0) setAppState('upload')
            else setAppState('editing') // Go back to editing existing
        }
    }

    const analyzePageWithGemini = async (page: PageData, pageIndex: number): Promise<Source[]> => {
        try {
            const response = await fetch(page.imageDataUrl)
            const blob = await response.blob()
            const file = new File([blob], 'page.png', { type: 'image/png' })
            const formData = new FormData()
            formData.append('image', file)

            const res = await fetch('/api/sources/analyze', { method: 'POST', body: formData })
            const data = await res.json() as { success: boolean; sources?: Array<{ id?: string; box: { x: number; y: number; width: number; height: number }; text?: string; reference?: string | null }> }

            if (data.success && data.sources?.length) {
                return data.sources.map((s, idx) => ({
                    id: s.id || `src-${Date.now()}-${idx}`,
                    pageIndex,
                    box: s.box,
                    polygon: null,
                    rotation: 0,
                    clippedImage: null,
                    name: s.reference || `Source ${idx + 1}`,
                    reference: s.reference || null,
                    displaySize: 75
                }))
            }
            return []
        } catch { return [] }
    }

    // ============================================================================
    // SOURCE MANAGEMENT
    // ============================================================================

    const deleteSource = (id: string) => {
        setSources(prev => prev.filter(s => s.id !== id))
        if (selectedSourceId === id) setSelectedSourceId(null)
    }

    const updateSourceName = (id: string, name: string) => {
        setSources(prev => prev.map(s => s.id === id ? { ...s, name } : s))
    }

    const updateSourceRotation = (id: string, rotation: number) => {
        setSources(prev => prev.map(s => {
            if (s.id !== id) return s

            // Only clear the image (triggering re-clip) if we have the original page loaded
            // Otherwise, keep the existing image and we'll rotate it visually/on-save
            const hasPage = pages[s.pageIndex]
            return {
                ...s,
                rotation,
                clippedImage: hasPage ? null : s.clippedImage
            }
        }))
    }

    const updateSourceDisplaySize = (id: string, displaySize: number) => {
        setSources(prev => prev.map(s => s.id === id ? { ...s, displaySize } : s))
    }

    const clearPage = () => {
        setSources(prev => prev.filter(s => s.pageIndex !== currentPageIndex))
    }

    const applyQuickGrid = (rows: number) => {
        const rowHeight = 90 / rows
        const newSources: Source[] = []
        for (let i = 0; i < rows; i++) {
            newSources.push({
                id: `grid-${Date.now()}-${i}`,
                pageIndex: currentPageIndex,
                box: { x: 5, y: 5 + i * rowHeight, width: 90, height: rowHeight },
                polygon: null,
                rotation: 0,
                clippedImage: null,
                name: `Source ${i + 1}`,
                reference: null,
                displaySize: 75
            })
        }
        setSources(prev => [...prev.filter(s => s.pageIndex !== currentPageIndex), ...newSources])
    }

    // ============================================================================
    // DRAWING / EDITING
    // ============================================================================

    const getPos = (e: React.MouseEvent) => {
        // Use the image element directly for accurate positioning
        if (!imageRef.current) return { x: 0, y: 0 }
        const rect = imageRef.current.getBoundingClientRect()
        // clientX/clientY are relative to viewport - rect is also relative to viewport
        // This should work correctly even with scrolling
        const x = ((e.clientX - rect.left) / rect.width) * 100
        const y = ((e.clientY - rect.top) / rect.height) * 100
        return {
            x: Math.max(0, Math.min(100, x)),
            y: Math.max(0, Math.min(100, y))
        }
    }

    const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (drawMode === 'polygon' && appState === 'editing') {
            setPolygonPoints(prev => [...prev, getPos(e)])
        }
    }

    const finishPolygon = () => {
        if (polygonPoints.length >= 3) {
            setSources(prev => [...prev, {
                id: `poly-${Date.now()}`,
                pageIndex: currentPageIndex,
                box: null,
                polygon: [...polygonPoints],
                rotation: 0,
                clippedImage: null,
                name: `Polygon ${prev.length + 1}`,
                reference: null,
                displaySize: 75
            }])
        }
        setPolygonPoints([])
    }

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (appState !== 'editing' || drawMode !== 'rectangle' || editMode !== 'none') return
        e.preventDefault() // Prevent text selection
        const pos = getPos(e)
        setIsDrawing(true)
        setDrawStart(pos)
        setDrawEnd(pos)
        setSelectedSourceId(null)
    }

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const pos = getPos(e)
        setMousePos(pos) // Track mouse position for live preview lines

        // Rotating - with damping for less sensitivity
        if (editMode === 'rotate' && editingSourceId && editStart) {
            const source = sources.find(s => s.id === editingSourceId)
            if (source?.box) {
                const centerX = source.box.x + source.box.width / 2
                const centerY = source.box.y + source.box.height / 2
                const rawAngle = Math.atan2(pos.y - centerY, pos.x - centerX) * (180 / Math.PI)
                // Add 90 degrees offset so 0° is at top, and dampen to 2° steps
                const adjustedAngle = rawAngle + 90
                const snappedAngle = Math.round(adjustedAngle / 2) * 2
                // Normalize to -180 to 180
                const normalizedAngle = ((snappedAngle + 180) % 360) - 180
                updateSourceRotation(editingSourceId, normalizedAngle)
            }
            return
        }

        // Dragging
        if (editMode === 'drag' && editingSourceId && editStart?.box) {
            const dx = pos.x - editStart.x
            const dy = pos.y - editStart.y
            setSources(prev => prev.map(s => {
                if (s.id !== editingSourceId || !s.box) return s
                return {
                    ...s,
                    box: {
                        ...s.box,
                        x: Math.max(0, Math.min(100 - editStart.box!.width, editStart.box!.x + dx)),
                        y: Math.max(0, Math.min(100 - editStart.box!.height, editStart.box!.y + dy))
                    },
                    clippedImage: null
                }
            }))
            return
        }

        // Resizing
        if (editMode === 'resize' && editingSourceId && editStart?.box && resizeHandle) {
            const dx = pos.x - editStart.x
            const dy = pos.y - editStart.y
            setSources(prev => prev.map(s => {
                if (s.id !== editingSourceId || !s.box) return s
                let { x, y, width, height } = editStart.box!
                if (resizeHandle.includes('w')) { x += dx; width -= dx }
                if (resizeHandle.includes('e')) { width += dx }
                if (resizeHandle.includes('n')) { y += dy; height -= dy }
                if (resizeHandle.includes('s')) { height += dy }
                return { ...s, box: { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(5, width), height: Math.max(5, height) }, clippedImage: null }
            }))
            return
        }

        if (isDrawing) setDrawEnd(pos)
    }

    const handleMouseUp = () => {
        if (editMode !== 'none') {
            setEditMode('none')
            setEditingSourceId(null)
            setEditStart(null)
            setResizeHandle(null)
            return
        }

        if (!isDrawing || !drawStart || !drawEnd) { setIsDrawing(false); return }

        const x = Math.min(drawStart.x, drawEnd.x)
        const y = Math.min(drawStart.y, drawEnd.y)
        const width = Math.abs(drawEnd.x - drawStart.x)
        const height = Math.abs(drawEnd.y - drawStart.y)

        if (width > 3 && height > 3) {
            setSources(prev => [...prev, {
                id: `rect-${Date.now()}`,
                pageIndex: currentPageIndex,
                box: { x, y, width, height },
                polygon: null,
                rotation: 0,
                clippedImage: null,
                name: `Source ${prev.length + 1}`,
                reference: null,
                displaySize: 75
            }])
        }
        setIsDrawing(false)
        setDrawStart(null)
        setDrawEnd(null)
    }

    const startDrag = (e: React.MouseEvent, source: Source) => {
        if (!source.box) return
        e.stopPropagation()
        e.preventDefault() // Prevent text selection
        setEditMode('drag')
        setEditingSourceId(source.id)
        setEditStart({ ...getPos(e), box: { ...source.box } })
        setSelectedSourceId(source.id)
    }

    const startResize = (e: React.MouseEvent, source: Source, handle: 'nw' | 'ne' | 'sw' | 'se') => {
        if (!source.box) return
        e.stopPropagation()
        e.preventDefault() // Prevent text selection
        setEditMode('resize')
        setResizeHandle(handle)
        setEditingSourceId(source.id)
        setEditStart({ ...getPos(e), box: { ...source.box } })
        setSelectedSourceId(source.id)
    }

    const startRotate = (e: React.MouseEvent, source: Source) => {
        e.stopPropagation()
        e.preventDefault() // Prevent text selection
        setEditMode('rotate')
        setEditingSourceId(source.id)
        setEditStart({ ...getPos(e), rotation: source.rotation })
        setSelectedSourceId(source.id)
    }

    const currentPageSources = sources.filter(s => s.pageIndex === currentPageIndex)

    // ============================================================================
    // IDENTIFY / SEARCH SOURCE
    // ============================================================================

    const handleIdentifySource = async (sourceId: string) => {
        const source = sources.find(s => s.id === sourceId)
        if (!source?.clippedImage) {
            alert('No image to analyze. Please wait for the clip to generate.')
            return
        }

        setIdentifyingId(sourceId)
        setIdentifyTargetId(sourceId) // Track which source we are searching for

        try {
            // Fetch blob from data URL
            const res = await fetch(source.clippedImage)
            const blob = await res.blob()
            const file = new File([blob], 'source.png', { type: 'image/png' })

            const formData = new FormData()
            formData.append('image', file)

            const apiRes = await fetch('/api/sources/identify', { method: 'POST', body: formData })
            const data = await apiRes.json() as { success: boolean, candidates: Array<{ sourceName: string, sefariaRef: string, previewText: string }>, error?: string, debug?: string[], searchQuery?: string }

            console.log('Identify API Response:', data)
            if (data.debug) {
                console.log('Debug log:', data.debug)
            }

            if (data.success && data.candidates?.length > 0) {
                setIdentifyResults(data.candidates)
            } else {
                // Show debug info
                const debugMsg = Array.isArray(data.debug) ? data.debug.join('\n') : (data.debug || '')
                const fullMsg = `${data.error || 'No sources identified'}\n\nSearch: ${data.searchQuery || 'N/A'}\n\nDebug:\n${debugMsg}`
                alert(fullMsg)
                setIdentifyResults(null)
            }
        } catch (e) {
            console.error(e)
            alert('Search failed: ' + String(e))
        } finally {
            setIdentifyingId(null)
        }
    }

    const applyIdentification = (result: { sourceName: string, sefariaRef: string }) => {
        if (!identifyTargetId) return

        setSources(prev => prev.map(s => {
            if (s.id !== identifyTargetId) return s
            return {
                ...s,
                name: result.sourceName,
                reference: result.sefariaRef
            }
        }))

        // Close modal
        setIdentifyResults(null)
        setIdentifyTargetId(null)
    }

    // ============================================================================
    // APPLY TO SHIUR
    // ============================================================================

    const [saving, setSaving] = useState(false)

    const applyToShiur = async () => {
        if (!selectedShiurId) {
            alert('Please select a shiur first')
            return
        }

        setSaving(true)
        setStatusMessage('Generating source sheet...')

        try {
            // Combine all source images into one PDF-like image
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')!

            // Calculate total height needed
            const imgWidth = 800
            let totalHeight = 0
            const loadedImages: HTMLImageElement[] = []

            for (const source of sources) {
                if (source.clippedImage) {
                    const img = new Image()
                    img.src = source.clippedImage
                    await new Promise(resolve => { img.onload = resolve })
                    const aspectRatio = img.height / img.width
                    totalHeight += imgWidth * aspectRatio + 40 // 40px padding between
                    loadedImages.push(img)
                }
            }

            canvas.width = imgWidth
            canvas.height = totalHeight + 60

            // White background
            ctx.fillStyle = 'white'
            ctx.fillRect(0, 0, canvas.width, canvas.height)

            // Draw each source
            let yOffset = 30
            sources.forEach((source, idx) => {
                if (source.clippedImage && loadedImages[idx]) {
                    const img = loadedImages[idx]
                    const isSide = Math.abs(source.rotation) % 180 === 90
                    // If rotated 90/270, the displayed height depends on the original WIDTH
                    // Aspect Ratio = H / W
                    const effectiveAspect = isSide ? (img.width / img.height) : (img.height / img.width)
                    const h = imgWidth * effectiveAspect

                    // Draw source name
                    ctx.fillStyle = '#1e293b'
                    ctx.font = 'bold 16px system-ui'
                    ctx.fillText(`${idx + 1}. ${source.name}`, 10, yOffset - 5)

                    // Draw image with rotation
                    ctx.save()
                    // Move to center of the target visual box
                    ctx.translate(imgWidth / 2, yOffset + h / 2)
                    ctx.rotate((source.rotation * Math.PI) / 180)

                    if (isSide) {
                        // If rotated 90/270, we swap dimensions
                        // We draw the image such that its "Width" (local X) becomes the Visual Height
                        // and its "Height" (local Y) becomes the Visual Width
                        ctx.drawImage(img, -h / 2, -imgWidth / 2, h, imgWidth)
                    } else {
                        // Normal 0/180
                        ctx.drawImage(img, -imgWidth / 2, -h / 2, imgWidth, h)
                    }
                    ctx.restore()

                    yOffset += h + 40
                }
            })

            // Store as JSON with individual source images uploaded to R2.
            // We BAKE the rotation into the image so the frontend doesn't need to handle it
            // and so aspect ratios are correct in the final image.
            const shiur = shiurim.find(s => s.id === selectedShiurId)
            const uploadSlug = shiur?.slug || shiur?.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'source'

            let uploadedCount = 0
            const sourceData = await Promise.all(sources.map(async (source) => {
                let finalImage = source.clippedImage
                let finalRotation = source.rotation

                if (source.rotation !== 0 && source.clippedImage) {
                    try {
                        finalImage = await rotateImage(source.clippedImage, source.rotation)
                        finalRotation = 0 // Reset rotation since it's baked in
                    } catch (e) {
                        console.error('Failed to rotate image', e)
                    }
                }

                // Upload image to R2 if it's a base64 data URL
                let imageUrl = finalImage
                if (finalImage && finalImage.startsWith('data:')) {
                    setStatusMessage(`Uploading source image ${++uploadedCount} of ${sources.length}...`)
                    imageUrl = await uploadImageToR2(finalImage, uploadSlug, source.id)
                }

                return {
                    id: source.id,
                    name: source.name,
                    image: imageUrl,
                    rotation: finalRotation,
                    reference: source.reference,
                    displaySize: source.displaySize || 75
                }
            }))

            // Save as JSON string to sourcesJson field (separate from PDF link in sourceDoc)
            const sourcesJsonStr = JSON.stringify(sourceData)

            // Upload original PDF to R2 if we have one
            let pdfUrl: string | undefined
            if (uploadedPdfFiles.length > 0) {
                setStatusMessage('Uploading PDF to storage...')
                const pdfFile = uploadedPdfFiles[0]
                const pdfFormData = new FormData()
                pdfFormData.append('file', pdfFile)
                pdfFormData.append('slug', uploadSlug)
                const pdfRes = await fetch('/api/upload', { method: 'POST', body: pdfFormData })
                if (pdfRes.ok) {
                    const pdfData = await pdfRes.json() as { url: string }
                    pdfUrl = pdfData.url
                } else {
                    console.error('PDF upload failed, continuing without sourceDoc')
                }
            }

            // Save to the shiur
            setStatusMessage('Saving to shiur...')

            const updateBody: Record<string, string> = { sourcesJson: sourcesJsonStr }
            if (pdfUrl) {
                updateBody.sourceDoc = pdfUrl
            }

            const res = await fetch(`/api/shiurim/${selectedShiurId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateBody)
            })

            if (!res.ok) {
                const errData = await res.json() as { error?: string }
                throw new Error(errData.error || 'Failed to update shiur')
            }

            setStatusMessage(`✓ Applied to "${shiur?.title}"`)
            alert(`Source sheet successfully applied to "${shiur?.title}"!\n\nThe sources have been saved and will display on the shiur page.`)

        } catch (err) {
            console.error('Failed to apply:', err)
            alert(`Error: ${err instanceof Error ? err.message : String(err)}`)
            setStatusMessage('Failed to apply')
        }

        setSaving(false)
    }

    // Handle Shiur Selection -> Auto-load existing sources
    useEffect(() => {
        if (!selectedShiurId) return

        const shiur = shiurim.find(s => s.id === selectedShiurId)
        if (shiur?.sourcesJson) {
            try {
                const loaded = JSON.parse(shiur.sourcesJson) as any[]
                if (Array.isArray(loaded)) {
                    // Map 'image' (saved format) to 'clippedImage' (internal state format)
                    const mappedSources = loaded.map(s => ({
                        ...s,
                        clippedImage: s.image || s.clippedImage,
                        // Ensure other required fields exist
                        displaySize: s.displaySize || 75,
                        rotation: s.rotation || 0
                    }))
                    setSources(mappedSources)
                    // If we have sources but no pages, go to Preview mode so user can see/edit the list
                    // They can then click "Add PDF" to upload a document
                    if (pages.length === 0) {
                        setAppState('preview')
                    }
                }
            } catch (e) {
                console.error('Failed to parse existing sources', e)
            }
        }
    }, [selectedShiurId, shiurim, pages.length]) // Dependencies

    // Auto-generate clipped images (ONLY for sources on current canvas pages)
    useEffect(() => {
        const updated = sources.map(s => {
            // Only clip if we DON'T have a clip yet AND we have the page loaded
            if (!s.clippedImage && (s.box || s.polygon) && pages[s.pageIndex]) {
                const page = pages[s.pageIndex]
                if (page) return { ...s, clippedImage: clipSourceImage(s, page) }
            }
            return s
        })
        const hasChanges = updated.some((s, i) => s.clippedImage !== sources[i].clippedImage)
        if (hasChanges) setSources(updated)
    }, [sources, pages])

    // ============================================================================
    // RENDER
    // ============================================================================

    return (
        <div className="h-screen flex flex-col bg-slate-100">
            {/* HEADER - Show when we have content (pages OR sources) */}
            {(appState === 'editing' || appState === 'preview' || sources.length > 0) && (
                <header className="bg-white border-b px-4 py-2 flex items-center justify-between shadow-sm sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <h1 className="text-lg font-bold text-slate-800">📜 Source Clipper</h1>

                        {/* Add PDF Button - Always available here */}
                        <button
                            onClick={() => setAppState('upload')}
                            className="text-xs flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-1.5 rounded hover:bg-blue-100 transition-colors font-medium border border-blue-100"
                        >
                            <span>+</span> Add PDF
                        </button>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                        {/* Draw mode (Only relevant in Edit mode with pages) */}
                        {appState === 'editing' && pages.length > 0 && (
                            <>
                                <div className="flex bg-slate-100 rounded p-0.5">
                                    <button onClick={() => { setDrawMode('rectangle'); setPolygonPoints([]) }} className={`px-2 py-1 rounded ${drawMode === 'rectangle' ? 'bg-white shadow' : ''}`}>▭ Rect</button>
                                    <button onClick={() => setDrawMode('polygon')} className={`px-2 py-1 rounded ${drawMode === 'polygon' ? 'bg-white shadow' : ''}`}>⬡ Poly</button>
                                </div>

                                {polygonPoints.length > 0 && (
                                    <>
                                        <span className="text-slate-500">{polygonPoints.length} pts</span>
                                        <button onClick={finishPolygon} disabled={polygonPoints.length < 3} className="px-2 py-1 bg-green-500 text-white rounded disabled:opacity-50">✓</button>
                                        <button onClick={() => setPolygonPoints([])} className="px-2 py-1 bg-red-500 text-white rounded">✗</button>
                                    </>
                                )}
                            </>
                        )}

                        {/* Page nav (Only if pages exist) */}
                        {pages.length > 0 && (
                            <div className="flex items-center gap-1 bg-slate-100 rounded px-2 py-1">
                                <button onClick={() => setCurrentPageIndex(Math.max(0, currentPageIndex - 1))} disabled={currentPageIndex === 0} className="disabled:opacity-30">←</button>
                                <span>{currentPageIndex + 1}/{pages.length}</span>
                                <button onClick={() => setCurrentPageIndex(Math.min(pages.length - 1, currentPageIndex + 1))} disabled={currentPageIndex === pages.length - 1} className="disabled:opacity-30">→</button>
                            </div>
                        )}

                        {/* Quick Grid (Only Edit mode) */}
                        {appState === 'editing' && pages.length > 0 && (
                            <div className="relative group">
                                <button className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">Grid</button>
                                <div className="absolute right-0 top-full mt-1 bg-white border rounded shadow-lg p-1 hidden group-hover:block z-20 min-w-[80px]">
                                    {[2, 3, 4, 5, 6].map(n => (
                                        <button key={n} onClick={() => applyQuickGrid(n)} className="block w-full text-left px-3 py-1 hover:bg-blue-50 rounded whitespace-nowrap">{n} rows</button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {pages.length > 0 && <button onClick={clearPage} className="px-2 py-1 text-red-600 hover:bg-red-50 rounded">Clear</button>}

                        {/* View toggle */}
                        <div className="flex bg-slate-100 rounded p-0.5">
                            {/* Disable Edit if no pages */}
                            <button onClick={() => setAppState('editing')} disabled={pages.length === 0} className={`px-2 py-1 rounded ${appState === 'editing' ? 'bg-white shadow' : ''} disabled:opacity-50`}>Edit</button>
                            <button onClick={() => setAppState('preview')} className={`px-2 py-1 rounded ${appState === 'preview' ? 'bg-white shadow' : ''}`}>Preview</button>
                        </div>

                        {statusMessage && <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded">{statusMessage}</span>}
                    </div>
                </header>
            )}

            {/* MAIN */}
            <div className="flex-1 flex overflow-hidden">
                {/* UPLOAD */}
                {appState === 'upload' && (
                    <div className="flex-1 flex items-center justify-center bg-slate-50">
                        <div className="max-w-sm w-full mx-auto p-6">
                            {/* Upload Box */}
                            <div
                                onClick={() => document.getElementById('file-input')?.click()}
                                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f) }}
                                onDragOver={(e) => e.preventDefault()}
                                className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/20 transition-all"
                            >
                                <div className="text-4xl mb-3">📄</div>
                                <h2 className="text-lg font-semibold text-slate-700 mb-1">Drop PDF here</h2>
                                <p className="text-sm text-slate-400">or click to browse</p>
                                {error && <p className="text-red-600 mt-3 text-sm">{error}</p>}
                                <input id="file-input" type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }} />
                            </div>
                        </div>
                    </div>
                )}

                {/* PROCESSING */}
                {appState === 'processing' && (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <div className="text-5xl mb-4 animate-bounce">🔍</div>
                            <p className="text-lg">{statusMessage}</p>
                        </div>
                    </div>
                )}

                {/* EDITING */}
                {appState === 'editing' && pages.length > 0 && (
                    <>
                        <div className="flex-1 overflow-auto p-4 flex justify-center items-start">
                            <div
                                ref={canvasRef}
                                className="relative inline-flex cursor-crosshair select-none"
                                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                                onClick={handleCanvasClick}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                            >
                                <img
                                    ref={imageRef}
                                    src={pages[currentPageIndex].imageDataUrl}
                                    alt="Page"
                                    className="max-h-[calc(100vh-100px)] shadow-xl rounded-lg pointer-events-none select-none block"
                                    draggable={false}
                                />

                                {/* Render sources - overlay on same coordinate system as image */}
                                {currentPageSources.map((source, idx) => {
                                    if (source.box) {
                                        const isSelected = selectedSourceId === source.id
                                        return (
                                            <div
                                                key={source.id}
                                                onClick={(e) => { e.stopPropagation(); setSelectedSourceId(source.id) }}
                                                className={`absolute border-2 ${isSelected ? 'border-green-500 bg-green-500/20 z-20' : 'border-blue-500 bg-blue-500/10'}`}
                                                style={{
                                                    left: `${source.box.x}%`, top: `${source.box.y}%`,
                                                    width: `${source.box.width}%`, height: `${source.box.height}%`,
                                                    transform: source.rotation ? `rotate(${source.rotation}deg)` : undefined,
                                                    transformOrigin: 'center'
                                                }}
                                            >
                                                {/* Number */}
                                                <span className="absolute -top-3 -left-3 w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center shadow">{idx + 1}</span>

                                                {/* Delete */}
                                                <button onClick={(e) => { e.stopPropagation(); deleteSource(source.id) }} className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 text-white rounded-full shadow">×</button>

                                                {/* ROTATION HANDLE - Circular, positioned outside the box */}
                                                <div
                                                    onMouseDown={(e) => startRotate(e, source)}
                                                    className="absolute -top-8 left-1/2 -translate-x-1/2 w-6 h-6 bg-orange-500 hover:bg-orange-600 rounded-full cursor-grab flex items-center justify-center text-white text-xs shadow-lg"
                                                    title={`Rotate (${source.rotation}°)`}
                                                >
                                                    ↻
                                                </div>
                                                {/* Rotation indicator line */}
                                                <div className="absolute -top-5 left-1/2 w-px h-3 bg-orange-500" />

                                                {/* Drag area */}
                                                <div onMouseDown={(e) => startDrag(e, source)} className="absolute inset-2 cursor-move" />

                                                {/* Resize handles */}
                                                <div onMouseDown={(e) => startResize(e, source, 'nw')} className="absolute -top-1 -left-1 w-3 h-3 bg-blue-600 cursor-nw-resize" />
                                                <div onMouseDown={(e) => startResize(e, source, 'ne')} className="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 cursor-ne-resize" />
                                                <div onMouseDown={(e) => startResize(e, source, 'sw')} className="absolute -bottom-1 -left-1 w-3 h-3 bg-blue-600 cursor-sw-resize" />
                                                <div onMouseDown={(e) => startResize(e, source, 'se')} className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-600 cursor-se-resize" />
                                            </div>
                                        )
                                    } else if (source.polygon && source.polygon.length >= 3) {
                                        return (
                                            <svg key={source.id} className="absolute inset-0 w-full h-full pointer-events-none" style={{ transform: source.rotation ? `rotate(${source.rotation}deg)` : undefined }}>
                                                <polygon
                                                    points={source.polygon.map(p => `${p.x}%,${p.y}%`).join(' ')}
                                                    fill={selectedSourceId === source.id ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.15)'}
                                                    stroke={selectedSourceId === source.id ? '#22c55e' : '#3b82f6'}
                                                    strokeWidth="2"
                                                    className="pointer-events-auto cursor-pointer"
                                                    onClick={() => setSelectedSourceId(source.id)}
                                                />
                                            </svg>
                                        )
                                    }
                                    return null
                                })}

                                {/* Drawing preview - rectangle */}
                                {isDrawing && drawStart && drawEnd && (
                                    <div className="absolute border-2 border-blue-600 bg-blue-500/30 pointer-events-none" style={{
                                        left: `${Math.min(drawStart.x, drawEnd.x)}%`, top: `${Math.min(drawStart.y, drawEnd.y)}%`,
                                        width: `${Math.abs(drawEnd.x - drawStart.x)}%`, height: `${Math.abs(drawEnd.y - drawStart.y)}%`
                                    }} />
                                )}

                                {/* Drawing preview - polygon with LINES */}
                                {polygonPoints.length > 0 && (
                                    <svg
                                        className="absolute inset-0 w-full h-full pointer-events-none"
                                        style={{ zIndex: 50 }}
                                        viewBox="0 0 100 100"
                                        preserveAspectRatio="none"
                                    >
                                        {/* Lines connecting points in order - solid blue lines */}
                                        {polygonPoints.length > 1 && (
                                            <polyline
                                                points={polygonPoints.map(p => `${p.x},${p.y}`).join(' ')}
                                                fill="none"
                                                stroke="#2563eb"
                                                strokeWidth="1.5px"
                                                vectorEffect="non-scaling-stroke"
                                            />
                                        )}
                                        {/* Live line from last point to mouse cursor */}
                                        {polygonPoints.length > 0 && mousePos && (
                                            <line
                                                x1={polygonPoints[polygonPoints.length - 1].x}
                                                y1={polygonPoints[polygonPoints.length - 1].y}
                                                x2={mousePos.x}
                                                y2={mousePos.y}
                                                stroke="#2563eb"
                                                strokeWidth="1.5px"
                                                vectorEffect="non-scaling-stroke"
                                            />
                                        )}
                                    </svg>
                                )}

                                {/* Points - Rendered as DIVs for constant pixel size */}
                                {polygonPoints.map((p, i) => (
                                    <div
                                        key={i}
                                        className="absolute w-2 h-2 bg-blue-600 rounded-full border border-white z-50 pointer-events-none"
                                        style={{
                                            left: `${p.x}%`,
                                            top: `${p.y}%`,
                                            transform: 'translate(-50%, -50%)'
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Sidebar - source list */}
                        <aside className="w-80 bg-white border-l flex flex-col">
                            <div className="p-3 border-b bg-slate-50 font-semibold">Sources ({currentPageSources.length})</div>
                            <div className="flex-1 overflow-auto">
                                {currentPageSources.map((source, idx) => (
                                    <div key={source.id} onClick={() => setSelectedSourceId(source.id)} className={`p-3 border-b cursor-pointer ${selectedSourceId === source.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center">{idx + 1}</span>
                                            <span className="text-sm font-medium flex-1 truncate">{source.name}</span>
                                            <span className="text-xs text-orange-500">{source.rotation}°</span>
                                            <button onClick={(e) => { e.stopPropagation(); deleteSource(source.id) }} className="text-red-500 text-sm">×</button>
                                        </div>
                                        {source.clippedImage && <SourcePreviewImage src={source.clippedImage} rotation={source.rotation} alt="" className="w-full rounded border" />}
                                    </div>
                                ))}
                            </div>
                        </aside>
                    </>
                )}

                {/* PREVIEW - Clean stacked layout with editable names */}
                {appState === 'preview' && (
                    <div className="flex-1 overflow-auto bg-white">
                        <div className="max-w-3xl mx-auto p-8">
                            <h1 className="text-2xl font-bold text-center mb-6 pb-4 border-b">Source Sheet</h1>

                            {sources.length === 0 ? (
                                <p className="text-center text-slate-400">No sources</p>
                            ) : (
                                <div className="space-y-6">
                                    {sources.map((source, idx) => (
                                        <div key={source.id} className="border rounded-lg overflow-hidden shadow-sm bg-white">
                                            {/* Header with controls */}
                                            <div className="bg-slate-50 px-4 py-3 space-y-3">
                                                {/* Row 1: Index + Name + Delete */}
                                                <div className="flex items-center gap-3">
                                                    <span className="w-7 h-7 bg-blue-600 text-white text-sm font-bold rounded-full flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                                                    <input
                                                        type="text"
                                                        value={source.name}
                                                        onChange={(e) => updateSourceName(source.id, e.target.value)}
                                                        className="flex-1 min-w-[150px] bg-white px-2 py-1.5 rounded border focus:border-blue-500 focus:outline-none text-sm font-medium shadow-sm"
                                                        placeholder="Source name..."
                                                    />
                                                    <button onClick={() => deleteSource(source.id)} className="text-red-500 hover:bg-red-100 rounded p-1.5 transition-colors" title="Delete source">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                                    </button>
                                                </div>

                                                {/* Search / Reference Bar */}
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={() => handleIdentifySource(source.id)}
                                                        disabled={!!identifyingId}
                                                        className="flex items-center gap-1.5 text-xs font-semibold bg-violet-100 text-violet-700 px-2 py-1.5 rounded hover:bg-violet-200 disabled:opacity-50 transition-colors"
                                                    >
                                                        {identifyingId === source.id ? (
                                                            <>
                                                                <span className="animate-spin">⏳</span> Searching...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span>🔍</span> Identify Source
                                                            </>
                                                        )}
                                                    </button>

                                                    {source.reference ? (
                                                        <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded border text-slate-600 truncate flex-1 block">
                                                            {source.reference}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-slate-400 italic">No reference set</span>
                                                    )}
                                                </div>

                                                {/* Row 2: Rotation Slider + Input */}
                                                <div className="flex items-center gap-3 pl-10">
                                                    <span className="text-xs text-slate-500 whitespace-nowrap w-16">Rotation:</span>
                                                    <input
                                                        type="range"
                                                        min="-180"
                                                        max="180"
                                                        step="1"
                                                        value={source.rotation}
                                                        onChange={(e) => updateSourceRotation(source.id, parseInt(e.target.value) || 0)}
                                                        className="flex-1 h-1.5 bg-slate-300 rounded-full appearance-none cursor-pointer accent-blue-600"
                                                    />
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="number"
                                                            value={source.rotation}
                                                            onChange={(e) => updateSourceRotation(source.id, parseInt(e.target.value) || 0)}
                                                            className="w-14 text-xs px-1 py-1 border rounded text-center bg-white"
                                                            min="-180"
                                                            max="180"
                                                        />
                                                        <span className="text-xs text-slate-500 w-2">°</span>
                                                    </div>
                                                </div>

                                                {/* Row 3: Size Slider */}
                                                <div className="flex items-center gap-3 pl-10">
                                                    <span className="text-xs text-slate-500 whitespace-nowrap w-16">Size:</span>
                                                    <input
                                                        type="range"
                                                        min="25"
                                                        max="100"
                                                        step="5"
                                                        value={source.displaySize}
                                                        onChange={(e) => updateSourceDisplaySize(source.id, parseInt(e.target.value))}
                                                        className="flex-1 h-1.5 bg-slate-300 rounded-full appearance-none cursor-pointer accent-blue-600"
                                                    />
                                                    <span className="text-xs text-slate-600 font-medium w-16 text-right px-1">{source.displaySize}%</span>
                                                </div>
                                            </div>

                                            {/* Image Preview at scaled size */}
                                            {source.clippedImage ? (
                                                <div className="p-4 bg-slate-50 flex justify-center">
                                                    <SourcePreviewImage
                                                        src={source.clippedImage}
                                                        rotation={source.rotation}
                                                        alt={source.name}
                                                        style={{
                                                            width: `${source.displaySize}%`,
                                                            maxWidth: '100%',
                                                        }}
                                                        className="border rounded shadow-sm transition-all"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="h-24 bg-slate-100 flex items-center justify-center text-slate-400 text-sm">No preview</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* APPLY TO SHIUR */}
                            {sources.length > 0 && (
                                <div className="mt-8 p-4 bg-gradient-to-r from-slate-50 to-blue-50 rounded-lg border">
                                    <h2 className="font-semibold mb-3 text-sm flex items-center gap-2">
                                        <span>📎</span> Attach to Shiur
                                    </h2>
                                    <div className="space-y-2">
                                        <select
                                            value={selectedShiurId || ''}
                                            onChange={(e) => setSelectedShiurId(e.target.value || null)}
                                            className="w-full px-3 py-2.5 border rounded-lg text-sm bg-white"
                                            disabled={loadingShiurim || saving}
                                        >
                                            <option value="">-- Select a Shiur --</option>
                                            {shiurim.map(s => (
                                                <option key={s.id} value={s.id}>{s.title.substring(0, 50)}{s.title.length > 50 ? '...' : ''}</option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={applyToShiur}
                                            disabled={!selectedShiurId || saving}
                                            className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-sm"
                                        >
                                            {saving ? '⏳ Saving...' : '✓ Apply to Shiur'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {/* IDENTIFY MODAL */}
            {identifyResults && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden">
                        <div className="p-4 border-b flex items-center justify-between bg-slate-50">
                            <h3 className="font-bold text-lg">Select Search Result</h3>
                            <button onClick={() => setIdentifyResults(null)} className="text-slate-400 hover:text-slate-600">×</button>
                        </div>
                        <div className="p-4 overflow-y-auto space-y-3">
                            {identifyResults.map((result, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => applyIdentification(result)}
                                    className="border rounded-lg p-3 hover:bg-blue-50 hover:border-blue-300 cursor-pointer transition-all group"
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="font-bold text-slate-800">{result.sourceName}</div>
                                        <div className="flex items-center gap-2">
                                            <a
                                                href={`https://www.sefaria.org/${result.sefariaRef.replace(/ /g, '_')}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200 hover:bg-emerald-200 transition-colors"
                                            >
                                                View on Sefaria ↗
                                            </a>
                                            <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border">{result.sefariaRef}</span>
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-600 line-clamp-2 font-serif bg-slate-50 p-2 rounded" dir="rtl">
                                        {result.previewText}
                                    </p>
                                    <div className="mt-2 text-xs text-blue-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                        Click to apply this source
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-3 border-t bg-slate-50 text-right">
                            <button onClick={() => setIdentifyResults(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
