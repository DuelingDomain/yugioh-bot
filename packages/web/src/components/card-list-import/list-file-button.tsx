"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { LIST_FILE_ACCEPT, readListFile } from "@/lib/card-list-import";

/**
 * "Load a file": reads a .txt or .ydk file and hands its text to the box, so nobody has to open it and copy.
 * The surfaces style their buttons differently, so the classes come from the caller.
 */
export function ListFileButton({
  onLoaded,
  onError,
  buttonClassName,
  inputClassName,
  disabled,
  label = "Load a file",
}: {
  onLoaded: (text: string, fileName: string) => void;
  onError: (message: string) => void;
  buttonClassName: string;
  inputClassName: string;
  disabled?: boolean;
  label?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={LIST_FILE_ACCEPT}
        className={inputClassName}
        aria-label="Upload card list file"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (!file) return;
          readListFile(file).then((text) => onLoaded(text, file.name), (error: unknown) => onError(error instanceof Error ? error.message : "Couldn't read that file."));
        }}
      />
      <button className={buttonClassName} type="button" disabled={disabled} onClick={() => ref.current?.click()}>
        <Upload size={16} aria-hidden="true" />
        {label}
      </button>
    </>
  );
}
