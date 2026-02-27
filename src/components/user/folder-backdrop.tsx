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
      className="min-h-screen w-full cursor-pointer"
      onClick={handleBackdropClick}
      aria-label="Click outside content to go back"
    >
      <div
        className="container mx-auto px-4 py-8 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
