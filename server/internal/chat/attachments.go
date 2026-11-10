package chat

import (
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"

	"mayelai/server/internal/openai"
)

// Attachment is a file sent with a chat message, base64-encoded by the browser.
type Attachment struct {
	Name string `json:"name"`
	Type string `json:"type"` // MIME type as reported by the browser (only a hint)
	Data string `json:"data"` // base64, without a data: prefix
}

// AttachmentError is a problem with an attachment that the user can fix.
type AttachmentError struct{ Msg string }

func (e *AttachmentError) Error() string { return e.Msg }

func attachErr(format string, a ...any) error {
	return &AttachmentError{Msg: fmt.Sprintf(format, a...)}
}

// Attachment kinds, stored in message metadata.
const (
	KindImage       = "image"
	KindPDF         = "pdf"
	KindSpreadsheet = "spreadsheet"
	KindText        = "text"
)

// processed is an attachment ready to send to the model.
type processed struct {
	name, kind string
	size       int
	text       string       // extracted text (text and spreadsheet kinds)
	truncated  bool         // text was cut to fit the budget
	part       *openai.Part // image or file part (image and pdf kinds)
}

var textExts = map[string]bool{
	".txt": true, ".md": true, ".markdown": true, ".json": true, ".xml": true, ".html": true, ".htm": true,
	".yaml": true, ".yml": true, ".log": true, ".ini": true, ".toml": true,
	".py": true, ".js": true, ".jsx": true, ".ts": true, ".tsx": true, ".go": true, ".java": true,
	".c": true, ".h": true, ".cpp": true, ".hpp": true, ".cs": true, ".rb": true, ".php": true,
	".sh": true, ".sql": true, ".css": true, ".rs": true, ".kt": true, ".swift": true, ".r": true,
	".tex": true,
}

var imageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

// processAttachments validates and converts attachments. Extracted text is
// limited to s.cfg.MaxAttachmentChars in total across all files.
func (s *Service) processAttachments(in []Attachment) ([]processed, error) {
	if len(in) == 0 {
		return nil, nil
	}
	if len(in) > s.cfg.MaxAttachments {
		return nil, attachErr("You can attach up to %d files per message.", s.cfg.MaxAttachments)
	}
	budget := s.cfg.MaxAttachmentChars
	out := make([]processed, 0, len(in))
	for _, a := range in {
		name := cleanName(a.Name)
		data, err := base64.StdEncoding.DecodeString(a.Data)
		if err != nil {
			return nil, attachErr("Couldn't read %q.", name)
		}
		if len(data) == 0 {
			return nil, attachErr("%q is empty.", name)
		}
		if len(data) > s.cfg.MaxAttachmentBytes {
			return nil, attachErr("%q is too large (max %d MB per file).", name, s.cfg.MaxAttachmentBytes>>20)
		}
		p := processed{name: name, size: len(data)}
		ext := strings.ToLower(filepath.Ext(name))
		sniffed := http.DetectContentType(data)

		switch {
		case imageTypes[sniffed]:
			p.kind = KindImage
			p.part = &openai.Part{Type: "image_url", ImageURL: &openai.ImageURL{
				URL:    "data:" + sniffed + ";base64," + a.Data,
				Detail: s.cfg.ImageDetail,
			}}
		case bytes.HasPrefix(data, []byte("%PDF-")):
			p.kind = KindPDF
			p.part = &openai.Part{Type: "file", File: &openai.File{
				Filename: name,
				FileData: "data:application/pdf;base64," + a.Data,
			}}
		case ext == ".xlsx" || ext == ".xlsm":
			p.kind = KindSpreadsheet
			text, err := xlsxToCSV(data)
			if err != nil {
				return nil, attachErr("Couldn't open the spreadsheet %q.", name)
			}
			p.text = text
		case ext == ".xls":
			return nil, attachErr("%q is an old Excel file (.xls). Save it as .xlsx or .csv and try again.", name)
		case ext == ".csv" || ext == ".tsv":
			p.kind = KindSpreadsheet
			if p.text, err = utf8Text(data); err != nil {
				return nil, attachErr("%q isn't a readable text file.", name)
			}
		case textExts[ext] || strings.HasPrefix(a.Type, "text/") || strings.HasPrefix(sniffed, "text/plain"):
			p.kind = KindText
			if p.text, err = utf8Text(data); err != nil {
				return nil, attachErr("%q isn't a readable text file.", name)
			}
		default:
			return nil, attachErr("%q isn't a supported file type. Try photos, PDFs, text files or spreadsheets (.csv, .xlsx).", name)
		}

		if p.kind == KindText || p.kind == KindSpreadsheet {
			if budget <= 0 {
				return nil, attachErr("The attached files contain too much text. Attach fewer or smaller files.")
			}
			if r := []rune(p.text); len(r) > budget {
				p.text, p.truncated = string(r[:budget]), true
			}
			budget -= len([]rune(p.text))
		}
		out = append(out, p)
	}
	return out, nil
}

// hasVisual reports whether any attachment is an image or PDF.
func hasVisual(ps []processed) bool {
	for _, p := range ps {
		if p.part != nil {
			return true
		}
	}
	return false
}

// attachmentMeta is what we store with the user's message. Text is kept so
// follow-up questions about a file still work; images and PDFs are not stored.
func attachmentMeta(ps []processed) []map[string]any {
	out := make([]map[string]any, 0, len(ps))
	for _, p := range ps {
		m := map[string]any{"name": p.name, "kind": p.kind, "size": p.size}
		if p.text != "" {
			m["text"] = p.text
		}
		if p.truncated {
			m["truncated"] = true
		}
		out = append(out, m)
	}
	return out
}

// userContent builds the user's turn: their text followed by each text
// attachment, wrapped so the model can tell them apart.
func userContent(text string, ps []processed) string {
	var b strings.Builder
	b.WriteString(text)
	for _, p := range ps {
		b.WriteString(fileBlock(p.name, p.kind, p.text, p.truncated))
	}
	return b.String()
}

func fileBlock(name, kind, text string, truncated bool) string {
	switch kind {
	case KindText, KindSpreadsheet:
		note := ""
		if truncated {
			note = "\n[file truncated]"
		}
		return fmt.Sprintf("\n\n<attached_file name=%q type=%q>\n%s%s\n</attached_file>", name, kind, text, note)
	case KindImage:
		return fmt.Sprintf("\n\n[The user attached an image %q in this message.]", name)
	case KindPDF:
		return fmt.Sprintf("\n\n[The user attached a PDF %q in this message.]", name)
	}
	return ""
}

// historyContent rebuilds an earlier user message, including the text of any
// files attached to it. Images and PDFs are not resent (they aren't stored).
func historyContent(content string, meta map[string]any) string {
	list, _ := meta["attachments"].([]any)
	if len(list) == 0 {
		return content
	}
	var b strings.Builder
	b.WriteString(content)
	for _, item := range list {
		m, _ := item.(map[string]any)
		name, _ := m["name"].(string)
		kind, _ := m["kind"].(string)
		text, _ := m["text"].(string)
		truncated, _ := m["truncated"].(bool)
		switch kind {
		case KindImage, KindPDF:
			fmt.Fprintf(&b, "\n\n[Earlier the user attached the %s %q; it is no longer available to view.]", kind, name)
		default:
			b.WriteString(fileBlock(name, kind, text, truncated))
		}
	}
	return b.String()
}

// attachmentNames returns "a.csv, b.png" for titles and summaries.
func attachmentNames(meta map[string]any) string {
	list, _ := meta["attachments"].([]any)
	names := make([]string, 0, len(list))
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			if n, ok := m["name"].(string); ok {
				names = append(names, n)
			}
		}
	}
	return strings.Join(names, ", ")
}

func cleanName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == '"' {
			return -1
		}
		return r
	}, name)
	if name == "" || name == "." || name == "/" {
		name = "file"
	}
	return truncate(name, 100)
}

func utf8Text(data []byte) (string, error) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")) // BOM
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return "", fmt.Errorf("not utf-8 text")
	}
	return string(data), nil
}

// xlsxToCSV converts every sheet to CSV, each under a "## Sheet: name" header.
func xlsxToCSV(data []byte) (string, error) {
	// Cap decompressed size so a tiny "zip bomb" file can't exhaust memory.
	f, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{UnzipSizeLimit: 64 << 20, UnzipXMLSizeLimit: 32 << 20})
	if err != nil {
		return "", err
	}
	defer f.Close()
	var b strings.Builder
	for _, sheet := range f.GetSheetList() {
		rows, err := f.GetRows(sheet)
		if err != nil {
			return "", err
		}
		if len(rows) == 0 {
			continue
		}
		fmt.Fprintf(&b, "## Sheet: %s\n", sheet)
		w := csv.NewWriter(&b)
		for _, row := range rows {
			_ = w.Write(row)
		}
		w.Flush()
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String()), nil
}
