package chat

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"mayelai/server/internal/config"
	"mayelai/server/internal/db"
	"mayelai/server/internal/openai"
)

func testService() *Service {
	return &Service{cfg: config.Config{
		MaxAttachments: 5, MaxAttachmentBytes: 1 << 20, MaxAttachmentChars: 50, ImageDetail: "auto",
	}}
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

// 1x1 transparent PNG.
var tinyPNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

func TestProcessAttachments(t *testing.T) {
	s := testService()

	f := excelize.NewFile()
	_ = f.SetSheetRow("Sheet1", "A1", &[]any{"name", "qty"})
	_ = f.SetSheetRow("Sheet1", "A2", &[]any{"apples", 3})
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}

	ps, err := s.processAttachments([]Attachment{
		{Name: "photo.png", Type: "image/png", Data: b64(tinyPNG)},
		{Name: "stock.xlsx", Data: b64(buf.Bytes())},
		{Name: "notes.txt", Type: "text/plain", Data: b64([]byte("hello"))},
	})
	if err != nil {
		t.Fatal(err)
	}
	if ps[0].kind != KindImage || ps[0].part == nil || !strings.HasPrefix(ps[0].part.ImageURL.URL, "data:image/png;base64,") {
		t.Errorf("image: %+v", ps[0])
	}
	if ps[1].kind != KindSpreadsheet || !strings.Contains(ps[1].text, "apples,3") {
		t.Errorf("xlsx: %+v", ps[1])
	}
	if ps[2].kind != KindText || ps[2].text != "hello" {
		t.Errorf("text: %+v", ps[2])
	}

	// Text budget (50 chars) is shared and truncates.
	ps, err = s.processAttachments([]Attachment{{Name: "big.csv", Data: b64([]byte(strings.Repeat("a,b\n", 40)))}})
	if err != nil || !ps[0].truncated || len(ps[0].text) != 50 {
		t.Errorf("truncation: err=%v %+v", err, ps)
	}

	// Unsupported binary file and old .xls are rejected with a user-facing error.
	for _, a := range []Attachment{
		{Name: "app.exe", Data: b64([]byte{0x4d, 0x5a, 0, 1, 2})},
		{Name: "old.xls", Data: b64([]byte{0xd0, 0xcf, 0x11, 0xe0})},
	} {
		var ae *AttachmentError
		if _, err := s.processAttachments([]Attachment{a}); !errors.As(err, &ae) {
			t.Errorf("%s: want AttachmentError, got %v", a.Name, err)
		}
	}
}

func TestBuildPromptWithImage(t *testing.T) {
	s := testService()
	ps, _ := s.processAttachments([]Attachment{{Name: "p.png", Data: b64(tinyPNG)}})
	msgs := s.buildPrompt(&testConv, nil, "what is this?", ps)
	raw, _ := json.Marshal(msgs[len(msgs)-1])
	var got struct {
		Content []openai.Part `json:"content"`
	}
	if err := json.Unmarshal(raw, &got); err != nil || len(got.Content) != 2 || got.Content[1].Type != "image_url" {
		t.Fatalf("multi-part message: %s", raw)
	}

	// History: text attachments are re-sent, images are referenced by name only.
	h := historyContent("see file", map[string]any{"attachments": []any{
		map[string]any{"name": "a.csv", "kind": "spreadsheet", "text": "x,y"},
		map[string]any{"name": "p.png", "kind": "image"},
	}})
	if !strings.Contains(h, "x,y") || !strings.Contains(h, `"p.png"`) {
		t.Errorf("history content: %s", h)
	}
}

var testConv = db.Conversation{}
