package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

// Use cases the handlers call. Each handler decodes, calls exactly one, and encodes.
type (
	Cases interface {
		List(ctx context.Context) ([]entity.CaseListItem, error)
		Detail(ctx context.Context, caseID string) (entity.CaseDetail, error)
		Board(ctx context.Context) ([]entity.TechIssue, error)
	}
	Actions interface {
		Execute(ctx context.Context, caseID string, req entity.ActionRequest) (entity.ActionResult, error)
	}
	Replies interface {
		Execute(ctx context.Context, caseID, body string) (entity.CaseDetail, error)
	}
	Investigations interface {
		Start(ctx context.Context, caseID string) (*usecase.Investigation, error)
	}
	MetricsReader interface {
		Execute(ctx context.Context) (entity.Metrics, error)
	}
	Resetter interface {
		Execute(ctx context.Context) (entity.World, error)
	}
)

const maxBody = 64 << 10

// decode reads a JSON body strictly (unknown fields rejected) into v.
func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return entity.Fail(entity.ErrBadRequest, "Invalid JSON body: %v.", err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return entity.Fail(entity.ErrBadRequest, "Body must be a single JSON object.")
	}
	return nil
}

func listCases(u Cases) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := u.List(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, items)
	}
}

func getCase(u Cases) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		d, err := u.Detail(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, d)
	}
}

func getBoard(u Cases) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := u.Board(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, items)
	}
}

func postAction(u Actions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req entity.ActionRequest
		if err := decode(r, &req); err != nil {
			writeError(w, r, err)
			return
		}
		res, err := u.Execute(r.Context(), r.PathValue("id"), req)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	}
}

func postReply(u Replies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Body string `json:"body"`
		}
		if err := decode(r, &req); err != nil {
			writeError(w, r, err)
			return
		}
		d, err := u.Execute(r.Context(), r.PathValue("id"), req.Body)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, d)
	}
}

func getMetrics(u MetricsReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		m, err := u.Execute(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, m)
	}
}

func deleteState(u Resetter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := u.Execute(r.Context()); err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"reset": true})
	}
}

// postInvestigate streams the agent loop as SSE. Request errors (400/404/409/503) are plain JSON, before the stream.
func postInvestigate(u Investigations) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, r, errors.New("streaming unsupported"))
			return
		}
		inv, err := u.Start(r.Context(), r.PathValue("id"))
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
		// Errors are already sent as `error` + `done` events; the log keeps the details.
		if _, err := inv.Run(r.Context(), emit); err != nil && r.Context().Err() == nil {
			logErr(r, err)
		}
	}
}
