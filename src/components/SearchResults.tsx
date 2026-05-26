import type { SpotifyTrack } from '@/types/database'

interface Props {
  tracks: SpotifyTrack[]
  onSelect: (track: SpotifyTrack) => void
}

export function SearchResults({ tracks, onSelect }: Props) {
  if (tracks.length === 0) return null

  return (
    <ul className="border rounded-lg overflow-hidden mt-2 divide-y divide-zinc-100">
      {tracks.map((track) => (
        <li key={track.id}>
          <button
            type="button"
            onClick={() => onSelect(track)}
            className="w-full flex items-center gap-3 p-3 hover:bg-zinc-50 text-left transition-colors"
          >
            {track.album.images[0] && (
              <img
                src={track.album.images[0].url}
                alt=""
                className="w-10 h-10 rounded flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{track.name}</p>
              <p className="text-xs text-zinc-500 truncate">
                {track.artists.map((a) => a.name).join(', ')}
              </p>
            </div>
            {track.explicit && (
              <span className="text-xs bg-zinc-200 text-zinc-600 px-1 rounded flex-shrink-0">
                E
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
