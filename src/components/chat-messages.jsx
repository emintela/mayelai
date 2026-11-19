import { useState } from "react";
import { Check, Copy, FileSpreadsheet, FileText, Image as ImageIcon, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

// Pieces of a chat message shared by the Mayel'AI chat page and Mayele in onSave.

const ActionButton = ({ label, onClick, active, activeClass, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={cn(
      "rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground",
      active && activeClass
    )}
  >
    {children}
  </button>
);

// Copy / share / like / dislike under an assistant reply.
export const MessageActions = ({ message, onFeedback }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Mayel'AI", text: message.content });
      } catch {
        /* user cancelled */
      }
    } else {
      copy();
    }
  };

  return (
    <div className="mt-1 flex items-center gap-0.5 pl-1">
      <ActionButton label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      </ActionButton>
      <ActionButton label="Share" onClick={share}>
        <Share2 className="h-4 w-4" />
      </ActionButton>
      <ActionButton
        label="Good response"
        active={message.feedback === 1}
        activeClass="text-emerald-500 hover:text-emerald-500"
        onClick={() => onFeedback(message, message.feedback === 1 ? 0 : 1)}
      >
        <ThumbsUp className="h-4 w-4" fill={message.feedback === 1 ? "currentColor" : "none"} />
      </ActionButton>
      <ActionButton
        label="Bad response"
        active={message.feedback === -1}
        activeClass="text-rose-500 hover:text-rose-500"
        onClick={() => onFeedback(message, message.feedback === -1 ? 0 : -1)}
      >
        <ThumbsDown className="h-4 w-4" fill={message.feedback === -1 ? "currentColor" : "none"} />
      </ActionButton>
    </div>
  );
};

// Files attached to a user message: photo thumbnails (this session only) or name chips.
export const MessageAttachments = ({ message }) => {
  const list = message.localAttachments ?? message.metadata?.attachments;
  if (!list?.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", message.content && "mb-2")}>
      {list.map((a, i) =>
        a.previewUrl ? (
          <img
            key={i}
            src={a.previewUrl}
            alt={a.name}
            className="max-h-48 max-w-full rounded-xl object-cover"
          />
        ) : (
          <span
            key={i}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1 text-xs"
          >
            {a.kind === "spreadsheet" ? (
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
            ) : a.kind === "image" ? (
              <ImageIcon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{a.name}</span>
          </span>
        )
      )}
    </div>
  );
};

