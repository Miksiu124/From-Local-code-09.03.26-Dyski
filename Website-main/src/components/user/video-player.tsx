"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  Maximize,
  Minimize,
  Settings,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { logger } from "@/lib/logger";

interface QualityLevel {
  index: number;
  height: number;
  label: string;
}

interface VideoPlayerProps {
  contentItemId: string;
}

export function VideoPlayer({ contentItemId }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<any>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // Error state
  const [hlsError, setHlsError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  // Bumped to trigger useEffect re-run on manual retry only
  const [initKey, setInitKey] = useState(0);

  const MAX_AUTO_RETRIES = 2;

  // Initialize HLS.js
  useEffect(() => {
    if (!videoRef.current) return;
    let destroyed = false;

    // Clear previous error on re-init
    setHlsError(null);

    async function initHls() {
      try {
        const Hls = (await import("hls.js")).default;
        if (destroyed) return;

        if (Hls.isSupported() && videoRef.current) {
          const hls = new Hls({
            xhrSetup: (xhr: XMLHttpRequest) => {
              xhr.withCredentials = true;
            },
          });

          hls.loadSource(`/api/content/${contentItemId}/playlist/master.m3u8`);
          hls.attachMedia(videoRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (destroyed) return;
            const levels: QualityLevel[] = hls.levels.map(
              (level: { height: number }, index: number) => ({
                index,
                height: level.height,
                label: `${level.height}p`,
              })
            );
            setQualityLevels(levels);
            setLoading(false);
          });

          hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; type: string; details: string }) => {
            if (data.fatal) {
              logger.error("HLS fatal error", { type: data.type, details: data.details });

              // Try auto-recovery based on error type
              if (data.type === "networkError") {
                // Auto-retry for network errors
                if (retryCountRef.current < MAX_AUTO_RETRIES) {
                  retryCountRef.current += 1;
                  hls.startLoad();
                  return;
                }
                setHlsError("Network error — could not load the video. Check your connection and try again.");
              } else if (data.type === "mediaError") {
                // Try recovering from media error
                hls.recoverMediaError();
                return;
              } else {
                setHlsError("Playback error — this video could not be played.");
              }

              setLoading(false);
            }
          });

          hlsRef.current = hls;
        } else if (videoRef.current?.canPlayType("application/vnd.apple.mpegurl")) {
          videoRef.current.src = `/api/content/${contentItemId}/playlist/master.m3u8`;

          videoRef.current.addEventListener("error", () => {
            if (!destroyed) {
              setHlsError("Could not load the video.");
              setLoading(false);
            }
          });

          setLoading(false);
        }
      } catch (error) {
        logger.error("Failed to load HLS player", error);
        setHlsError("Failed to initialize the video player.");
        setLoading(false);
      }
    }

    initHls();
    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [contentItemId, initKey]);

  // Manual retry handler
  const handleRetry = useCallback(() => {
    setHlsError(null);
    setLoading(true);
    retryCountRef.current = 0;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setInitKey((k) => k + 1);
  }, []);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration || 0);
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onVolumeChange = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("progress", onProgress);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("volumechange", onVolumeChange);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("volumechange", onVolumeChange);
    };
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    const onFsc = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsc);
    return () => document.removeEventListener("fullscreenchange", onFsc);
  }, []);

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    if (playing) {
      hideTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
        setShowQualityMenu(false);
      }, 3000);
    }
  }, [playing]);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); };
  }, [playing, resetHideTimer]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (v) v.muted = !v.muted;
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.volume = val;
    if (val > 0 && v.muted) v.muted = false;
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * duration;
  }, [duration]);

  const handleProgressHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(pct * duration);
    setHoverX(e.clientX - rect.left);
  }, [duration]);

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    document.fullscreenElement ? document.exitFullscreen() : c.requestFullscreen();
  }, []);

  const handleQualityChange = useCallback((levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setCurrentQuality(levelIndex);
    }
    setShowQualityMenu(false);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !containerRef.current?.contains(document.activeElement) &&
        document.activeElement !== document.body
      ) return;

      const v = videoRef.current;
      if (!v) return;

      // Don't intercept Shift+Arrow (used for content navigation)
      if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          v.currentTime = Math.min(v.currentTime + 5, duration);
          break;
        case "ArrowLeft":
          e.preventDefault();
          v.currentTime = Math.max(v.currentTime - 5, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          v.volume = Math.min(v.volume + 0.1, 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          v.volume = Math.max(v.volume - 0.1, 0);
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "Escape":
          if (showQualityMenu) setShowQualityMenu(false);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [duration, togglePlay, toggleFullscreen, toggleMute, showQualityMenu]);

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const qualityLabel = currentQuality === -1
    ? "Auto"
    : qualityLevels.find((q) => q.index === currentQuality)?.label || "Auto";

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded-xl overflow-hidden aspect-video group select-none"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-controls]")) return;
        if (hlsError) return; // Don't toggle play while error is shown
        togglePlay();
        resetHideTimer();
      }}
      tabIndex={0}
      role="application"
      aria-label="Video player"
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        controlsList="nodownload"
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Loading spinner */}
      {loading && !hlsError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-12 w-12 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {hlsError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 px-6 text-center gap-4">
          <AlertTriangle className="h-12 w-12 text-red-400" />
          <p className="text-white text-sm max-w-sm">{hlsError}</p>
          <button
            onClick={(e) => { e.stopPropagation(); handleRetry(); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {/* Big play button */}
      {!playing && !loading && !hlsError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-5">
            <Play className="h-14 w-14 text-white fill-white" />
          </div>
        </div>
      )}

      {/* ──── Controls overlay ──── */}
      <div
        data-controls
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pb-4 pt-20 transition-opacity duration-300 ${
          showControls && !hlsError ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative w-full h-[6px] bg-white/20 rounded-full cursor-pointer group/progress mb-4 hover:h-[10px] transition-all"
          onClick={(e) => { e.stopPropagation(); handleSeek(e); }}
          onMouseMove={(e) => { e.stopPropagation(); handleProgressHover(e); }}
          onMouseLeave={() => setHoverTime(null)}
        >
          {/* Buffered */}
          <div
            className="absolute top-0 left-0 h-full bg-white/25 rounded-full pointer-events-none"
            style={{ width: `${bufferedPct}%` }}
          />
          {/* Progress fill */}
          <div
            className="absolute top-0 left-0 h-full bg-red-500 rounded-full pointer-events-none"
            style={{ width: `${progressPct}%` }}
          >
            {/* Scrub handle */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-red-500 rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-md -mr-2" />
          </div>

          {/* Hover timestamp tooltip */}
          {hoverTime !== null && (
            <div
              className="absolute -top-8 bg-black/90 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap"
              style={{ left: `${hoverX}px`, transform: "translateX(-50%)" }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
          {/* Play / Pause */}
          <button
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="text-white hover:text-white/80 transition-colors p-1.5"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause className="h-6 w-6 fill-white" />
            ) : (
              <Play className="h-6 w-6 fill-white" />
            )}
          </button>

          {/* Volume (always visible slider) */}
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
              className="text-white hover:text-white/80 transition-colors p-1.5"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              <VolumeIcon className="h-6 w-6" />
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => { e.stopPropagation(); handleVolumeChange(e); }}
              onClick={(e) => e.stopPropagation()}
              className="w-20 accent-white h-1 cursor-pointer"
              aria-label="Volume"
            />
          </div>

          {/* Time display */}
          <span className="text-white text-sm tabular-nums ml-1 select-none">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Quality selector */}
          {qualityLevels.length > 0 && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowQualityMenu(!showQualityMenu); }}
                className="flex items-center gap-1.5 text-white hover:text-white/80 transition-colors p-1.5 text-sm"
                aria-label="Quality settings"
              >
                <Settings className="h-5 w-5" />
                <span className="hidden sm:inline">{qualityLabel}</span>
              </button>

              {showQualityMenu && (
                <div
                  className="absolute bottom-full right-0 mb-3 bg-black/95 rounded-lg border border-white/10 py-1.5 min-w-[140px] z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleQualityChange(-1)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${
                      currentQuality === -1 ? "text-red-500 font-medium" : "text-white"
                    }`}
                  >
                    Auto
                  </button>
                  {qualityLevels
                    .sort((a, b) => b.height - a.height)
                    .map((level) => (
                      <button
                        key={level.index}
                        onClick={() => handleQualityChange(level.index)}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${
                          currentQuality === level.index ? "text-red-500 font-medium" : "text-white"
                        }`}
                      >
                        {level.label}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Fullscreen */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            className="text-white hover:text-white/80 transition-colors p-1.5"
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="h-6 w-6" />
            ) : (
              <Maximize className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
