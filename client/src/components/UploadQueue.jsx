import { useCallback, useEffect, useRef, useState } from 'react';

const ACCEPT = '.jpg,.jpeg,.png,.mp4,.mov';
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'mp4', 'mov'];

let nextId = 1;

/**
 * Drag-and-drop + file-picker upload queue. The list order is the EDIT order:
 * every tile carries a numbered badge, and items can be removed before submit.
 *
 * @param {{files: Array<{id: number, file: File, previewUrl: string, kind: string}>,
 *   onChange: function, disabled: boolean, title?: string, orderHint?: string,
 *   footer?: import('react').ReactNode}} props
 */
export default function UploadQueue({
  files,
  onChange,
  disabled,
  title = 'Upload queue',
  orderHint = 'Order below = edit order',
  footer = null,
}) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const filesRef = useRef(files);
  filesRef.current = files;

  // Revoke every outstanding object URL on unmount to avoid leaking blobs.
  useEffect(
    () => () => {
      filesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    },
    []
  );

  const addFiles = useCallback(
    (fileList) => {
      const accepted = Array.from(fileList).filter((file) => {
        const ext = file.name.split('.').pop().toLowerCase();
        return ALLOWED_EXTS.includes(ext);
      });
      if (accepted.length === 0) return;
      const additions = accepted.map((file) => ({
        id: nextId++,
        file,
        previewUrl: URL.createObjectURL(file),
        kind: /\.(mp4|mov)$/i.test(file.name) ? 'video' : 'image',
      }));
      onChange([...filesRef.current, ...additions]);
    },
    [onChange]
  );

  const removeFile = useCallback(
    (id) => {
      const target = filesRef.current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      onChange(filesRef.current.filter((item) => item.id !== id));
    },
    [onChange]
  );

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragActive(false);
      if (disabled) return;
      addFiles(event.dataTransfer.files);
    },
    [addFiles, disabled]
  );

  return (
    <section className="glass-card">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        <span className="text-xs text-zinc-500">{orderHint}</span>
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-300 ${
          disabled
            ? 'cursor-not-allowed border-zinc-800 text-zinc-600'
            : dragActive
              ? 'scale-[1.015] border-indigo-400 bg-indigo-500/10 text-indigo-200 shadow-lg shadow-indigo-950/50'
              : 'border-zinc-700 text-zinc-400 hover:border-indigo-500 hover:bg-white/[0.02] hover:text-indigo-300'
        }`}
      >
        <svg
          className={`mb-2 h-8 w-8 ${dragActive ? 'animate-bounce-soft' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm font-medium">Drag &amp; drop photos and clips here</p>
        <p className="mt-1 text-xs text-zinc-500">or click to browse — .jpg .jpeg .png .mp4 .mov, unlimited files</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 ? (
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {files.map((item, index) => (
            <li
              key={item.id}
              style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
              className="group relative animate-pop-in overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-950/40"
            >
              <span className="absolute left-1.5 top-1.5 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 px-1.5 text-xs font-bold text-white shadow-lg shadow-indigo-950">
                {index + 1}
              </span>
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => removeFile(item.id)}
                  aria-label={`Remove ${item.file.name}`}
                  className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900/80 text-zinc-400 opacity-0 transition hover:bg-red-600 hover:text-white group-hover:opacity-100"
                >
                  ×
                </button>
              ) : null}
              {item.kind === 'video' ? (
                <video src={item.previewUrl} muted preload="metadata" className="h-24 w-full object-cover" />
              ) : (
                <img src={item.previewUrl} alt={item.file.name} className="h-24 w-full object-cover" />
              )}
              <p className="truncate px-2 py-1.5 text-[11px] text-zinc-400" title={item.file.name}>
                {item.kind === 'video' ? '🎬' : '🖼️'} {item.file.name}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-center text-xs text-zinc-600">Nothing queued yet.</p>
      )}
      {footer}
    </section>
  );
}
