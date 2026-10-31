package entity

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// Ask (contract v2): the support agent asks Verdict about a stored verdict.
const (
	AskQuestionMaxRunes = 500
	AskAnswerMaxRunes   = 600 // ~50 words prompted; hard cap so a runaway answer never reaches the UI
)

// Answer is the POST /api/cases/{id}/ask body.
type Answer struct {
	Answer   string   `json:"answer"`
	Evidence []string `json:"evidence"`
}

// CheckQuestion trims the question and enforces 1–500 characters.
func CheckQuestion(q string) (string, error) {
	q = strings.TrimSpace(q)
	if n := utf8.RuneCountInString(q); n < 1 || n > AskQuestionMaxRunes {
		return "", Fail(ErrBadRequest, "question must be 1-%d characters.", AskQuestionMaxRunes)
	}
	return q, nil
}

var idToken = regexp.MustCompile(`[A-Za-z0-9_-]+`)

// CitedIDs returns the ids mentioned in answer that are in known, in first-mention order, deduplicated.
// Anything the model invents (not one of the case's records) is dropped.
func CitedIDs(answer string, known map[string]bool) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, tok := range idToken.FindAllString(answer, -1) {
		if known[tok] && !seen[tok] {
			seen[tok] = true
			out = append(out, tok)
		}
	}
	return out
}

// CapAnswer trims and cuts an answer to AskAnswerMaxRunes.
func CapAnswer(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= AskAnswerMaxRunes {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:AskAnswerMaxRunes-1])) + "…"
}
