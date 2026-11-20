package chat

import (
	"strings"
	"testing"
)

func TestFinancePrompt(t *testing.T) {
	s := testService()
	plain := s.buildPrompt(&testConv, nil, "hi", nil, "")
	if strings.Contains(plain[0].Content, "My Finances") {
		t.Fatal("normal chat got the finance instructions")
	}
	fin := s.buildPrompt(&testConv, nil, "where did I spend most?", nil, "BANK ACCOUNTS: Chase Checking 12,436.20 USD")
	sys := fin[0].Content
	if !strings.HasPrefix(sys, s.cfg.SystemPrompt) {
		t.Fatal("finance data must come after the fixed prompt (prompt caching)")
	}
	if !strings.Contains(sys, "My Finances") || !strings.Contains(sys, "Chase Checking 12,436.20 USD") || !strings.Contains(sys, "Never invent") {
		t.Fatalf("finance prompt: %s", sys)
	}
	if fin[len(fin)-1].Content != "where did I spend most?" {
		t.Fatalf("user message: %+v", fin[len(fin)-1])
	}
}
