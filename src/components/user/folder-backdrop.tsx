"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

interface FolderBackdropProps {
  children: React.ReactNode;
  folderName: string;
}

/**
 * Wraps folder content — clicking on dark margin/backdrop navigates back to main page,
 * same as clicking outside the player overlay.
 */
export function FolderBackdrop({ children, folderName }: FolderBackdropProps) {
  const router = useRouter();

  const handleBackdropClick = useCallback(() => {
    sessionStorage.setItem(`scroll_model_${folderName}`, String(window.scrollY));
    router.push("/");
  }, [folderName, router]);

  return (
    <div
      className="min-h-screen w-full min-w-0 cursor-pointer overflow-x-clip"
      onClick={handleBackdropClick}
      aria-label="Click outside content to go back"
    >
      <div
        className="mx-auto w-full min-w-0 max-w-7xl cursor-default py-8 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
