import { useRef, useState } from 'react'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

interface PhotoUploadProps {
  value: File | null
  existingUrl: string | null
  onChange: (file: File | null) => void
  onDelete?: () => void
}

export function PhotoUpload({ value, existingUrl, onChange, onDelete }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validate = (file: File): string | null => {
    if (!ACCEPTED.includes(file.type)) return 'Only JPEG, PNG, or WebP images are accepted.'
    if (file.size > MAX_BYTES) return 'Image must be 5 MB or smaller.'
    return null
  }

  const handleFile = (file: File) => {
    const err = validate(file)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    onChange(file)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const previewUrl = value ? URL.createObjectURL(value) : null
  const showPreview = previewUrl || existingUrl

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={handleInputChange}
        aria-label="Upload device photo"
      />

      {showPreview ? (
        <div className="flex items-start gap-3">
          <img
            src={previewUrl ?? existingUrl!}
            alt="Device photo preview"
            className="w-24 h-24 rounded-lg object-cover border border-gray-200"
          />
          <div className="flex flex-col gap-2 mt-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-sm text-blue-600 hover:underline text-left"
            >
              Change photo
            </button>
            {onDelete && existingUrl && !value && (
              <button
                type="button"
                onClick={onDelete}
                className="text-sm text-red-500 hover:underline text-left"
              >
                Remove photo
              </button>
            )}
            {value && (
              <button
                type="button"
                onClick={() => { setError(null); onChange(null) }}
                className="text-sm text-gray-500 hover:underline text-left"
              >
                Clear selection
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`w-full border-2 border-dashed rounded-lg px-4 py-6 text-center transition-colors
            ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}
        >
          <div className="text-2xl mb-1">📷</div>
          <div className="text-sm text-gray-500">Drag &amp; drop or click to browse</div>
          <div className="text-xs text-gray-400 mt-1">JPEG, PNG, or WebP · max 5 MB</div>
        </button>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
