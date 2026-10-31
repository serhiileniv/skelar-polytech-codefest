package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

// Fix-it use cases (docs/api.md → Fix-it).
type (
	Fixes interface {
		Start(ctx context.Context, caseID string) (*usecase.FixRun, error)
		Capabilities() []entity.FixCapability
	}
	FixApprovals interface {
		Execute(ctx context.Context, caseID, planID string, stepIDs []string) (entity.FixRunResult, error)
	}
)

func getFixCapabilities(u Fixes) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, u.Capabilities())
	}
}

// postFix streams the Fix-it loop as SSE, like postInvestigate. Request errors are plain JSON, before the stream.
func postFix(u Fixes) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, r, errors.New("streaming unsupported"))
			return
		}
		run, err := u.Start(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, r, err)
			return
		}
		h := w.Header()
		h.Set("Content-Type", "text/event-stream")
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		emit := func(event string, data any) error {
			body, err := json.Marshal(data)
			if err != nil {
				return err
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, body); err != nil {
				return err
			}
			flusher.Flush()
			return nil
		}
		if _, err := run.Run(r.Context(), emit); err != nil && r.Context().Err() == nil {
			logErr(r, err)
		}
	}
}

func postFixApprove(u FixApprovals) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			StepIDs []string `json:"stepIds"`
		}
		if err := decode(r, &req); err != nil {
			writeError(w, r, err)
			return
		}
		if req.StepIDs == nil {
			writeError(w, r, entity.Fail(entity.ErrBadRequest, "stepIds is required (an empty list approves no auto step)."))
			return
		}
		res, err := u.Execute(r.Context(), r.PathValue("id"), r.PathValue("planId"), req.StepIDs)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	}
}
