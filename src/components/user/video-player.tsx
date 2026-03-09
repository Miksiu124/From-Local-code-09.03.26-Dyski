"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
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
  const [autoplayEnabled, setAutoplayEnabled] = useState(false);

  const [hlsError, setHlsError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const [initKey, setInitKey] = useState(0);
  const [isIOS, setIsIOS] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const qualityButtonRef = useRef<HTMLButtonElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement | null>(null);
  const qualityMenuCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [qualityMenuRect, setQualityMenuRect] = useState<{ top: number; right: number } | null>(null);

  const MAX_AUTO_RETRIES = 2;

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setIsMobile("ontouchstart" in window || window.innerWidth < 768);
  }, []);

  // Fullscreen restore removed: ContentViewer now uses in-place nav when fullscreen,
  // so VideoPlayer stays mounted and fullscreen persists on Android.

  useEffect(() => {
    fetch("/api/user/preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.autoplay) setAutoplayEnabled(true);
      })
      .catch(() => { });
  }, []);

  // Initialize HLS.js
  useEffect(() => {
    if (!videoRef.current) return;
    let destroyed = false;
    let nativeErrorHandler: (() => void) | null = null;

    // Clear previous error on re-init
    setHlsError(null);

    async function initHls() {
      // Reset UI state from previous video so we don't show stale progress/time
      setCurrentTime(0);
      setDuration(0);
      setBuffered(0);
      setPlaying(false);
      setHlsError(null);
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
            if (autoplayEnabled && videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().then(() => {
                if (videoRef.current) videoRef.current.muted = false;
              }).catch(() => { });
            }
            const rawLevels = hls.levels as { height: number; width: number; bitrate: number; url: string[] }[];
            const levels: QualityLevel[] = rawLevels.map(
              (level, index: number) => {
                let label: string;
                if (level.height > 0) {
                  label = `${level.height}p`;
                } else {
                  const firstUrl = Array.isArray(level.url) ? level.url[0] || "" : String(level.url || "");
                  const urlParts = firstUrl.split("/");
                  const filename = urlParts[urlParts.length - 1] || "";
                  const match = filename.match(/(\d{3,4})p/);
                  if (match) {
                    label = `${match[1]}p`;
                  } else if (level.bitrate > 0) {
                    const mbps = level.bitrate / 1_000_000;
                    label = mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(level.bitrate / 1000)} kbps`;
                  } else {
                    label = `Quality ${index + 1}`;
                  }
                }
                return { index, height: level.height || level.bitrate || index, label };
              }
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
          const video = videoRef.current;
          video.src = `/api/content/${contentItemId}/playlist/master.m3u8`;

          nativeErrorHandler = () => {
            if (!destroyed) {
              setHlsError("Could not load the video.");
              setLoading(false);
            }
          };
          video.addEventListener("error", nativeErrorHandler);

          if (autoplayEnabled) {
            video.muted = true;
            video.play().then(() => {
              if (videoRef.current) videoRef.current.muted = false;
            }).catch(() => { });
          }

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
      // Clean up native HLS error listener (Safari)
      if (videoRef.current && nativeErrorHandler) {
        videoRef.current.removeEventListener("error", nativeErrorHandler);
      }
    };
  }, [contentItemId, initKey, autoplayEnabled]);

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

  // Fullscreen change listener (including webkit for iOS Safari)
  useEffect(() => {
    const onFsc = () => {
      const doc = document as any;
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsc);
    document.addEventListener("webkitfullscreenchange", onFsc);
    return () => {
      document.removeEventListener("fullscreenchange", onFsc);
      document.removeEventListener("webkitfullscreenchange", onFsc);
    };
  }, []);

  // iOS: video.webkitEnterFullscreen() doesn't fire document fullscreenchange; use video events
  useEffect(() => {
    const v = videoRef.current as HTMLVideoElement & { webkitbeginfullscreen?: () => void; webkitendfullscreen?: () => void };
    if (!v) return;
    const onBegin = () => setIsFullscreen(true);
    const onEnd = () => setIsFullscreen(false);
    v.addEventListener("webkitbeginfullscreen", onBegin);
    v.addEventListener("webkitendfullscreen", onEnd);
    return () => {
      v.removeEventListener("webkitbeginfullscreen", onBegin);
      v.removeEventListener("webkitendfullscreen", onEnd);
    };
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

  const getClientX = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>): number => {
    if ("touches" in e) return e.changedTouches?.[0]?.clientX ?? 0;
    return e.clientX;
  };

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const clientX = getClientX(e);
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = pct * duration;
  }, [duration]);

  const handleSeekBack = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - 10);
    resetHideTimer();
  }, [resetHideTimer]);

  const handleSeekForward = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(duration, v.currentTime + 10);
    resetHideTimer();
  }, [duration, resetHideTimer]);

  const handleProgressHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(pct * duration);
    setHoverX(e.clientX - rect.left);
  }, [duration]);

  const toggleFullscreen = useCallback(() => {
    const doc = document as any;
    const c = containerRef.current as any;
    const v = videoRef.current as any;
    if (!c) return;

    const isFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);

    if (isFs) {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => { });
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
      return;
    }

    // iOS: webkitEnterFullscreen wymaga aby wideo BYŁO ODTWARZANE — inaczej nie działa.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS && v) {
      const enterFs = (v as any).webkitEnterFullscreen || (v as any).webkitEnterFullScreen;
      if (enterFs) {
        const doFullscreen = () => { try { enterFs.call(v); } catch { } };
        if (v.paused) {
          v.play().then(doFullscreen).catch(doFullscreen);
        } else {
          doFullscreen();
        }
        return;
      }
    }

    // Android: Fullscreen API jest zawodny na video — najpierw container (bardziej niezawodny).
    // Niektóre przeglądarki wymagają play() przed fullscreen (user gesture).
    const isMobile = "ontouchstart" in window || window.innerWidth < 768;
    const isAndroid = /Android/i.test(navigator.userAgent);

    const tryContainerFullscreen = () => {
      const req = c.requestFullscreen || (c as any).webkitRequestFullscreen || (c as any).mozRequestFullScreen;
      if (!req) return false;
      try {
        if (v?.paused) {
          v.play().then(() => req.call(c)).catch(() => req.call(c));
        } else {
          req.call(c);
        }
        return true;
      } catch {
        return false;
      }
    };

    const tryVideoFullscreen = () => {
      if (!v) return false;
      const req = v.requestFullscreen || v.webkitRequestFullscreen;
      if (req) {
        if (v.paused) {
          v.play().then(() => req.call(v)).catch(() => req.call(v));
        } else {
          req.call(v);
        }
        return true;
      }
      const enterFs = (v as any).webkitEnterFullscreen || (v as any).webkitEnterFullScreen;
      if (enterFs) {
        if (v.paused) {
          v.play().then(() => enterFs.call(v)).catch(() => enterFs.call(v));
        } else {
          enterFs.call(v);
        }
        return true;
      }
      return false;
    };

    // Na Androidzie: container fullscreen działa lepiej niż video.requestFullscreen
    if (isMobile && isAndroid && tryContainerFullscreen()) return;
    if (isMobile && tryVideoFullscreen()) return;

    // Desktop lub fallback: container fullscreen
    if (!tryContainerFullscreen() && v) {
      tryVideoFullscreen();
    }
  }, []);

  const openQualityMenu = useCallback(() => {
    if (qualityMenuCloseTimeoutRef.current) {
      clearTimeout(qualityMenuCloseTimeoutRef.current);
      qualityMenuCloseTimeoutRef.current = null;
    }
    setShowQualityMenu(true);
  }, []);

  const scheduleQualityMenuClose = useCallback(() => {
    if (qualityMenuCloseTimeoutRef.current) clearTimeout(qualityMenuCloseTimeoutRef.current);
    qualityMenuCloseTimeoutRef.current = setTimeout(() => setShowQualityMenu(false), 200);
  }, []);

  const handleQualityChange = useCallback((levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.nextLevel = levelIndex;
      setCurrentQuality(levelIndex);
    }
    setShowQualityMenu(false);
    setQualityMenuRect(null);
  }, []);

  // Update quality menu position when opening (for portal — avoids overflow clipping)
  useEffect(() => {
    if (!showQualityMenu || !qualityButtonRef.current) {
      setQualityMenuRect(null);
      return;
    }
    const updateRect = () => {
      const btn = qualityButtonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setQualityMenuRect({ top: r.top, right: window.innerWidth - r.right });
    };
    updateRect();
    let scrollRaf: number | null = null;
    const throttledScroll = () => {
      if (scrollRaf != null) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        updateRect();
      });
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (qualityButtonRef.current?.contains(target)) return;
      if (qualityMenuRef.current?.contains(target)) return;
      setShowQualityMenu(false);
    };
    window.addEventListener("scroll", throttledScroll, { passive: true, capture: true });
    window.addEventListener("resize", updateRect);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("scroll", throttledScroll, true);
      if (scrollRaf != null) cancelAnimationFrame(scrollRaf);
      window.removeEventListener("resize", updateRect);
      document.removeEventListener("mousedown", handleClickOutside);
      if (qualityMenuCloseTimeoutRef.current) {
        clearTimeout(qualityMenuCloseTimeoutRef.current);
        qualityMenuCloseTimeoutRef.current = null;
      }
      setQualityMenuRect(null);
      qualityMenuRef.current = null;
    };
  }, [showQualityMenu]);

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
  const qualityLabel = currentQuality === -1
    ? "Auto"
    : qualityLevels.find((q) => q.index === currentQuality)?.label || "Auto";

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // Apple-style: tap left = -10s, tap right = +10s, tap center = play/pause
  // Mobile: first tap = show overlay only; second tap (center) = play/pause
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-controls]")) return;
    if (isIOS && (e.target === videoRef.current || videoRef.current?.contains(e.target as Node))) return; // iOS: native controls
    if (hlsError) return; // Don't toggle play while error is shown
    resetHideTimer();

    // Mobile: first tap only shows overlay, no play/pause
    if (isMobile && !showControls) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      // Desktop: seek only via arrow buttons (1:1 hit area); mobile: 25%/75% zones
      if (isMobile) {
        if (pct < 0.25) {
          handleSeekBack();
          return;
        }
        if (pct > 0.75) {
          handleSeekForward();
          return;
        }
      }
    }

    // Center zone — play/pause
    togglePlay();
  }, [togglePlay, resetHideTimer, hlsError, isIOS, isMobile, showControls, handleSeekBack, handleSeekForward]);

  return (
    <div
      ref={containerRef}
      data-video-player
      className="relative bg-black rounded-xl sm:rounded-2xl overflow-hidden aspect-video group select-none"
      style={{ touchAction: "manipulation" } as React.CSSProperties}
      onMouseMove={resetHideTimer}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
      onClick={handleContainerClick}
      tabIndex={0}
      role="application"
      aria-label="Video player"
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        controls={isIOS}
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

      {/* Big play button (ukryty na iOS — natywne controls) */}
      {!isIOS && !playing && !loading && !hlsError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-5">
            <Play className="h-14 w-14 text-white fill-white" />
          </div>
        </div>
      )}

      {/* Seek buttons — mobile: 48px touch target; desktop: 1:1 z ikoną (w-9 h-9) */}
      {!isIOS && showControls && !hlsError && (
        <>
          <button
            type="button"
            className="absolute left-3 sm:left-[12%] top-1/2 -translate-y-1/2 z-[6] opacity-60 hover:opacity-90 transition-opacity cursor-pointer bg-black/40 rounded-full p-3 min-w-[48px] min-h-[48px] sm:p-0 sm:w-9 sm:h-9 sm:min-w-0 sm:min-h-0 flex items-center justify-center"
            style={{ touchAction: "manipulation" } as React.CSSProperties}
            onClick={(e) => { e.stopPropagation(); handleSeekBack(); }}
            aria-label="Cofnij 10 sekund"
          >
            <img src="/icons/seek-back-10.png" alt="" className="h-8 w-8 sm:h-9 sm:w-9 object-contain invert" />
          </button>
          <button
            type="button"
            className="absolute right-3 sm:right-[12%] top-1/2 -translate-y-1/2 z-[6] opacity-60 hover:opacity-90 transition-opacity cursor-pointer bg-black/40 rounded-full p-3 min-w-[48px] min-h-[48px] sm:p-0 sm:w-9 sm:h-9 sm:min-w-0 sm:min-h-0 flex items-center justify-center"
            style={{ touchAction: "manipulation" } as React.CSSProperties}
            onClick={(e) => { e.stopPropagation(); handleSeekForward(); }}
            aria-label="Przewiń 10 sekund"
          >
            <img src="/icons/seek-forward-10.png" alt="" className="h-8 w-8 sm:h-9 sm:w-9 object-contain invert" />
          </button>
        </>
      )}

      {/* ──── Controls overlay (ukryte na iOS — używamy natywnych controls dla fullscreen) ──── */}
      {!isIOS && (
      <div
        data-controls
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 sm:px-5 pb-4 sm:pb-6 pt-16 sm:pt-20 transition-opacity duration-300 ${showControls && !hlsError ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        style={{ touchAction: "manipulation" } as React.CSSProperties}
      >
        {/* Progress bar — single bar (track + progress), taller on mobile for easier touch */}
        <div
          ref={progressRef}
          className="relative w-full h-3 sm:h-[6px] bg-white/20 rounded-full cursor-pointer group/progress mb-4 sm:hover:h-[10px] transition-all touch-none"
          onClick={(e) => { e.stopPropagation(); handleSeek(e); }}
          onTouchEnd={(e) => { e.stopPropagation(); handleSeek(e); }}
          onMouseMove={(e) => { e.stopPropagation(); handleProgressHover(e); }}
          onMouseLeave={() => setHoverTime(null)}
          style={{ touchAction: "none" } as React.CSSProperties}
        >
          {/* Progress fill only — buffered removed to avoid double-bar appearance */}
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

        {/* Controls row — scrollable on mobile when many buttons overflow (scrollbar hidden) */}
        <div
          className="flex items-center gap-2 sm:gap-3 flex-nowrap overflow-x-auto overflow-y-visible min-w-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          {/* Play / Pause — min 48px touch target na mobile (Android) */}
          <button
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="shrink-0 text-white hover:text-white/80 transition-colors p-1.5 min-w-[48px] min-h-[48px] flex items-center justify-center -m-1"
            style={{ touchAction: "manipulation" } as React.CSSProperties}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause className="h-6 w-6 fill-white" />
            ) : (
              <Play className="h-6 w-6 fill-white" />
            )}
          </button>

          {/* Volume (always visible slider) */}
          <div className="flex items-center gap-2 shrink-0">
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
              className="w-12 sm:w-20 accent-white h-1 cursor-pointer shrink-0"
              aria-label="Volume"
            />
          </div>

          {/* Time display */}
          <span className="shrink-0 text-white text-sm tabular-nums ml-1 select-none">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Quality selector — menu rendered via portal to avoid overflow clipping */}
          {qualityLevels.length > 0 && (
            <div className="relative shrink-0">
              <button
                ref={qualityButtonRef}
                onClick={(e) => { e.stopPropagation(); setShowQualityMenu((v) => !v); }}
                onMouseEnter={openQualityMenu}
                onMouseLeave={scheduleQualityMenuClose}
                className="flex items-center gap-1.5 text-white hover:text-white/80 transition-colors p-1.5 text-sm min-w-[44px] min-h-[44px] justify-center"
                aria-label="Quality settings"
                aria-expanded={showQualityMenu}
              >
                <Settings className="h-5 w-5" />
                <span className="hidden sm:inline">{qualityLabel}</span>
              </button>

              {showQualityMenu && qualityMenuRect && typeof document !== "undefined" && createPortal(
                <div
                  ref={(el) => { qualityMenuRef.current = el; }}
                  className="fixed bg-black/95 rounded-lg border border-white/10 py-1.5 min-w-[140px] z-[9999] shadow-xl"
                  style={{ top: qualityMenuRect.top - 8, right: qualityMenuRect.right, transform: "translateY(-100%)" }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseEnter={openQualityMenu}
                  onMouseLeave={scheduleQualityMenuClose}
                >
                  <button
                    onClick={() => handleQualityChange(-1)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${currentQuality === -1 ? "text-red-500 font-medium" : "text-white"}`}
                  >
                    Auto
                  </button>
                  {qualityLevels
                    .sort((a, b) => b.height - a.height)
                    .map((level) => (
                      <button
                        key={level.index}
                        onClick={() => handleQualityChange(level.index)}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${currentQuality === level.index ? "text-red-500 font-medium" : "text-white"}`}
                      >
                        {level.label}
                      </button>
                    ))}
                </div>,
                isFullscreen && containerRef.current ? containerRef.current : document.body
              )}
            </div>
          )}

          {/* Fullscreen — min 48px touch target for reliable tap on real mobile (DevTools uses mouse, real device uses finger) */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            className="min-w-[48px] min-h-[48px] flex items-center justify-center -m-2 text-white hover:text-white/80 transition-colors p-2"
            style={{ touchAction: "manipulation" } as React.CSSProperties}
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
      )}
    </div>
  );
}
