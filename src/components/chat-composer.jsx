import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Square,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FILE_ACCEPT,
  MAX_ATTACHMENTS,
  SPREADSHEET_ACCEPT,
  formatSize,
  prepareAttachment,
} from "@/lib/attachments";

export const MODES = {
  chat: { label: "Instant", description: "Fast answers", icon: Zap },
  search: { label: "Search", description: "Search the web for up-to-date answers", icon: Globe },
};

// Closes a popover when clicking outside it or pressing Escape.
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, ref]);
}

const SpeechRecognition =
  typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

// Browser dictation (Web Speech API): appends what the user says to the text box.
function useDictation(onText) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => recRef.current?.abort(), []);

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .slice(e.resultIndex)
        .filter((r) => r.isFinal)
        .map((r) => r[0].transcript)
        .join(" ");
      if (text) onTextRef.current(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return { supported: !!SpeechRecognition, listening, toggle };
}

const MenuItem = ({ icon: Icon, iconClass, label, description, onClick, selected }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-accent"
  >
    <Icon className={cn("h-5 w-5 shrink-0", iconClass)} />
    <span className="text-sm font-medium text-foreground">{label}</span>
    <span className="truncate text-sm text-muted-foreground">{description}</span>
    {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
  </button>
);

const AttachmentChip = ({ file, onRemove }) => {
  const Icon = file.kind === "spreadsheet" ? FileSpreadsheet : file.kind === "image" ? ImageIcon : FileText;
  return (
    <div className="group relative flex items-center gap-2 rounded-xl border border-border bg-muted/60 py-1.5 pl-1.5 pr-7">
      {file.previewUrl ? (
        <img src={file.previewUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
      ) : (
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            file.kind === "spreadsheet" ? "bg-emerald-500/15 text-emerald-600" : "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <p className="max-w-[10rem] truncate text-xs font-medium">{file.name}</p>
        <p className="text-[11px] uppercase text-muted-foreground">
          {file.kind === "pdf" ? "PDF" : file.kind} · {formatSize(file.size)}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="absolute right-1.5 top-1.5 rounded-full p-0.5 text-muted-foreground transition hover:bg-background hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

/**
 * Message box: "+" menu (photos & files, spreadsheets) on the left, text in
 * the middle, mode picker (Instant / Search), dictation and send on the right.
 *
 * onSend({ text, attachments, mode }) is awaited; the box clears when it is called.
 */
const ChatComposer = ({ onSend, disabled, busy, autoFocus, menuPlacement = "down", mode, onModeChange }) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [reading, setReading] = useState(0);
  const [error, setError] = useState(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const plusRef = useRef(null);
  const modeRef = useRef(null);
  const filesInput = useRef(null);
  const sheetsInput = useRef(null);
  const textRef = useRef(null);

  useDismiss(plusOpen, setPlusOpen, plusRef);
  useDismiss(modeOpen, setModeOpen, modeRef);

  const dictation = useDictation((spoken) => setText((t) => (t ? `${t} ${spoken}` : spoken)));

  // Grow the text box with its content, up to ~8 lines.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (files.length > room) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
    }
    setReading((n) => n + Math.min(files.length, room));
    for (const file of files.slice(0, Math.max(room, 0))) {
      try {
        const att = await prepareAttachment(file);
        setAttachments((prev) => [...prev, att]);
      } catch (e) {
        setError(e.message || `Couldn't read "${file.name}".`);
      } finally {
        setReading((n) => n - 1);
      }
    }
    textRef.current?.focus();
  };

  const pick = (input) => {
    setPlusOpen(false);
    input.current?.click();
  };

  const canSend = !disabled && !busy && reading === 0 && (text.trim().length > 0 || attachments.length > 0);

  const submit = (e) => {
    e?.preventDefault();
    if (!canSend) return;
    if (dictation.listening) dictation.toggle();
    const payload = { text: text.trim(), attachments, mode };
    setText("");
    setAttachments([]);
    onSend(payload);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  const onPaste = (e) => {
    if (e.clipboardData?.files?.length) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  };

  const menuPos = menuPlacement === "up" ? "bottom-full mb-2" : "top-full mt-2";
  const ModeIcon = MODES[mode].icon;
  const empty = text.trim() === "" && attachments.length === 0;

  return (
    <form onSubmit={submit} className="relative">
      <div
        className={cn(
          "rounded-[28px] border border-input bg-card p-2 shadow-sm transition focus-within:ring-2 focus-within:ring-primary/30",
          disabled && "opacity-60"
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled) addFiles(e.dataTransfer.files);
        }}
      >
        {(attachments.length > 0 || reading > 0) && (
          <div className="flex flex-wrap gap-2 px-1 pb-2 pt-1">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                file={a}
                onRemove={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
              />
            ))}
            {reading > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…
              </div>
            )}
          </div>
        )}

        <div className="flex items-end gap-1">
          {/* + menu */}
          <div ref={plusRef}>
            <button
              type="button"
              onClick={() => setPlusOpen((o) => !o)}
              disabled={disabled}
              aria-label="Add photos, files or spreadsheets"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground transition hover:bg-accent disabled:opacity-50"
            >
              <Plus className={cn("h-5 w-5 transition", plusOpen && "rotate-45")} />
            </button>
            {plusOpen && (
              <div
                role="menu"
                className={cn(
                  "absolute left-0 z-50 w-full max-w-md rounded-3xl border border-border bg-popover p-2 shadow-lg animate-in fade-in-0 zoom-in-95",
                  menuPos
                )}
              >
                <MenuItem
                  icon={Paperclip}
                  label="Add photos & files"
                  description="Images, PDFs, text and code"
                  onClick={() => pick(filesInput)}
                />
                <MenuItem
                  icon={FileSpreadsheet}
                  iconClass="text-emerald-600"
                  label="Spreadsheets"
                  description="Analyze .csv and .xlsx files"
                  onClick={() => pick(sheetsInput)}
                />
              </div>
            )}
          </div>

          <textarea
            ref={textRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={dictation.listening ? "Listening…" : "Ask Mayel'AI"}
            autoFocus={autoFocus}
            disabled={disabled}
            aria-label="Message"
            className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-5 outline-none placeholder:text-muted-foreground md:text-sm"
          />

          {/* Mode picker */}
          <div ref={modeRef}>
            <button
              type="button"
              onClick={() => setModeOpen((o) => !o)}
              disabled={disabled}
              aria-haspopup="menu"
              aria-expanded={modeOpen}
              className="flex h-10 items-center gap-1 rounded-full px-2 text-sm sm:px-3 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <ModeIcon className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">{MODES[mode].label}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
            {modeOpen && (
              <div
                role="menu"
                className={cn(
                  "absolute right-0 z-50 w-full max-w-72 rounded-2xl border border-border bg-popover p-1.5 shadow-lg animate-in fade-in-0 zoom-in-95",
                  menuPos
                )}
              >
                {Object.entries(MODES).map(([key, m]) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === key}
                    onClick={() => {
                      onModeChange(key);
                      setModeOpen(false);
                    }}
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent"
                  >
                    <m.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{m.label}</span>
                      <span className="block text-xs text-muted-foreground">{m.description}</span>
                    </span>
                    {mode === key && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {dictation.supported && (
            <button
              type="button"
              onClick={dictation.toggle}
              disabled={disabled}
              aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-accent",
                dictation.listening ? "text-rose-500" : "text-foreground"
              )}
            >
              {dictation.listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
            </button>
          )}

          {/* Send (or start dictation when the box is empty) */}
          {empty && dictation.supported && !busy ? (
            <button
              type="button"
              onClick={dictation.toggle}
              disabled={disabled}
              aria-label={dictation.listening ? "Stop voice input" : "Voice input"}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50",
                dictation.listening && "animate-pulse"
              )}
            >
              <AudioLines className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 px-4 text-xs text-destructive">
          {error}
        </p>
      )}

      <input
        ref={filesInput}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={sheetsInput}
        type="file"
        multiple
        accept={SPREADSHEET_ACCEPT}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </form>
  );
};

export default ChatComposer;
