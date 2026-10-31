package http

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

func TestToAPIError(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{"bad request", entity.Fail(entity.ErrBadRequest, "Invalid case id."), http.StatusBadRequest, "bad_request", "Invalid case id."},
		{"not found", entity.Fail(entity.ErrNotFound, "Case %s not found.", "case_999"), http.StatusNotFound, "not_found", "Case case_999 not found."},
		{"conflict wrapped", fmt.Errorf("usecase: %w", entity.Fail(entity.ErrConflict, "Already running.")), http.StatusConflict, "conflict", "Already running."},
		{"llm unavailable", entity.Fail(entity.ErrLLMUnavailable, "No API key and no replay."), http.StatusServiceUnavailable, "llm_unavailable", "No API key and no replay."},
		{"unknown hides details", errors.New("pq: password=secret"), http.StatusInternalServerError, "internal", "Something went wrong. Try again."},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, body := toAPIError(tt.err)
			if status != tt.wantStatus || body.Code != tt.wantCode || body.Message != tt.wantMsg {
				t.Errorf("got %d %+v, want %d %s %q", status, body, tt.wantStatus, tt.wantCode, tt.wantMsg)
			}
		})
	}
}
