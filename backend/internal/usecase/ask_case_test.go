package usecase

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

type fakeAnswerer struct {
	answer string
	err    error
	prompt string
	calls  int
}

func (f *fakeAnswerer) Answer(_ context.Context, _, prompt string) (string, error) {
	f.calls++
	f.prompt = prompt
	return f.answer, f.err
}

// askStore gives case_104 a stored tech_team verdict citing err_0002.
func askStore() *fakeStore {
	s := newFakeStore()
	for i := range s.w.Cases {
		if s.w.Cases[i].ID == "case_104" {
			s.w.Cases[i].Verdict = &entity.Verdict{Outcome: entity.OutcomeTechTeam, Summary: "Web cancel never reached the App Store.",
				Evidence: []entity.Evidence{{ID: "err_0002", Note: "Cancel sync failed"}}}
		}
	}
	return s
}

func TestAskCase(t *testing.T) {
	tests := []struct {
		name     string
		caseID   string
		question string
		model    fakeAnswerer
		wantErr  error
		wantEv   []string
		wantText string
	}{
		{"cites real ids, drops invented and other customers'", "case_104", "Why this outcome?",
			fakeAnswerer{answer: "The cancel did not sync (err_0002), so pay_0004 was charged. Also err_9999 and pay_0001."},
			nil, []string{"err_0002", "pay_0004"}, "err_0002"},
		{"no live model falls back to the verdict", "case_104", "Why?",
			fakeAnswerer{err: entity.Fail(entity.ErrLLMUnavailable, "replay")},
			nil, []string{"err_0002"}, "Web cancel never reached"},
		{"not in evidence has no ids", "case_104", "What is the weather?",
			fakeAnswerer{answer: "That is not in the evidence."}, nil, []string{}, "not in the evidence"},
		{"no verdict yet", "case_105", "Why?", fakeAnswerer{answer: "x"}, entity.ErrConflict, nil, ""},
		{"unknown case", "case_999", "Why?", fakeAnswerer{answer: "x"}, entity.ErrNotFound, nil, ""},
		{"bad case id", "../x", "Why?", fakeAnswerer{answer: "x"}, entity.ErrBadRequest, nil, ""},
		{"question too long", "case_104", strings.Repeat("a", 501), fakeAnswerer{answer: "x"}, entity.ErrBadRequest, nil, ""},
		{"empty question", "case_104", "  ", fakeAnswerer{answer: "x"}, entity.ErrBadRequest, nil, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := askStore()
			model := tt.model
			got, err := NewAskCase(store, &model).Ask(context.Background(), tt.caseID, tt.question)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				if model.calls != 0 {
					t.Fatalf("model called %d times on a rejected request", model.calls)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(got.Evidence, tt.wantEv) {
				t.Fatalf("evidence = %v, want %v", got.Evidence, tt.wantEv)
			}
			if !strings.Contains(got.Answer, tt.wantText) {
				t.Fatalf("answer %q lacks %q", got.Answer, tt.wantText)
			}
			for _, id := range store.scopedTo {
				if id != "cust_004" {
					t.Fatalf("read scoped to %s, want only cust_004", id)
				}
			}
		})
	}
}

func TestAskCaseModelErrorPropagates(t *testing.T) {
	model := &fakeAnswerer{err: errors.New("network")}
	if _, err := NewAskCase(askStore(), model).Ask(context.Background(), "case_104", "Why?"); err == nil {
		t.Fatal("want error")
	}
}
