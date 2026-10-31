// Package http is the controller layer: decode → one usecase call → encode. No business logic, no SQL.
package http

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// ApiError is the single error body (docs/api.md → Errors).
type ApiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// toAPIError maps a domain error to an HTTP status and a toast-safe body. Unknown errors become 500 internal.
func toAPIError(err error) (int, ApiError) {
	msg := err.Error()
	var de *entity.Error
	if errors.As(err, &de) {
		msg = de.Msg // drop wrapping prefixes added by inner layers
	}
	switch {
	case errors.Is(err, entity.ErrBadRequest):
		return http.StatusBadRequest, ApiError{"bad_request", msg}
	case errors.Is(err, entity.ErrNotFound):
		return http.StatusNotFound, ApiError{"not_found", msg}
	case errors.Is(err, entity.ErrConflict):
		return http.StatusConflict, ApiError{"conflict", msg}
	case errors.Is(err, entity.ErrLLMUnavailable):
		return http.StatusServiceUnavailable, ApiError{"llm_unavailable", msg}
	default:
		return http.StatusInternalServerError, ApiError{"internal", "Something went wrong. Try again."}
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode response", "err", err)
	}
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, body := toAPIError(err)
	if status >= 500 {
		logErr(r, err)
	}
	writeJSON(w, status, body)
}

func logErr(r *http.Request, err error) {
	slog.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path, "err", err)
}
