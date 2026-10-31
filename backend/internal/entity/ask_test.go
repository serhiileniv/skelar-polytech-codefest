package entity

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCheckQuestion(t *testing.T) {
	tests := []struct {
		name, in, want string
		wantErr        bool
	}{
		{"trimmed", "  Why this outcome?  ", "Why this outcome?", false},
		{"empty", "", "", true},
		{"only spaces", "   ", "", true},
		{"500 runes ok", strings.Repeat("я", 500), strings.Repeat("я", 500), false},
		{"501 runes rejected", strings.Repeat("a", 501), "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CheckQuestion(tt.in)
			if tt.wantErr {
				if !errors.Is(err, ErrBadRequest) {
					t.Fatalf("err = %v, want bad_request", err)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("got %q, %v; want %q", got, err, tt.want)
			}
		})
	}
}

func TestCitedIDs(t *testing.T) {
	known := map[string]bool{"err_0002": true, "pay_0004": true, "sub_0004": true}
	tests := []struct {
		name, answer string
		want         []string
	}{
		{"inline ids in mention order", "Charged (pay_0004) after cancel; sync failed (err_0002).", []string{"pay_0004", "err_0002"}},
		{"duplicates once", "err_0002, err_0002 and err_0002.", []string{"err_0002"}},
		{"unknown ids dropped", "See err_9999 and pay_0004 and cust_004.", []string{"pay_0004"}},
		{"no ids", "That is not in the evidence.", []string{}},
		{"prefix of an id is not the id", "err_00021 is not err_0002x.", []string{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CitedIDs(tt.answer, known); !slices.Equal(got, tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCapAnswer(t *testing.T) {
	tests := []struct {
		name, in string
		maxRunes int
	}{
		{"short kept", "  ok  ", 2},
		{"long cut", strings.Repeat("word ", 400), AskAnswerMaxRunes},
		{"120-word answer cut to 600", strings.Repeat("word ", 120), 600},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if n := utf8.RuneCountInString(CapAnswer(tt.in)); n > tt.maxRunes {
				t.Fatalf("len = %d, want <= %d", n, tt.maxRunes)
			}
		})
	}
}
