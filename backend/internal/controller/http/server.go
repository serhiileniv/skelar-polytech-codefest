package http

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Pinger reports whether the database is reachable (satisfied by *pgxpool.Pool).
type Pinger interface {
	Ping(ctx context.Context) error
}

type Deps struct {
	DB              Pinger
	Cases           Cases
	Actions         Actions
	Replies         Replies
	Investigations  Investigations
	Metrics         MetricsReader
	Reset           Resetter
	FrontendOrigins []string // CORS allow-list; "*" allows any origin
	Log             *slog.Logger
}

// NewRouter registers every route in docs/api.md.
func NewRouter(d Deps) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health(d.DB))
	mux.HandleFunc("GET /api/cases", listCases(d.Cases))
	mux.HandleFunc("GET /api/cases/{id}", getCase(d.Cases))
	mux.HandleFunc("POST /api/cases/{id}/investigate", postInvestigate(d.Investigations))
	mux.HandleFunc("POST /api/cases/{id}/actions", postAction(d.Actions))
	mux.HandleFunc("POST /api/cases/{id}/reply", postReply(d.Replies))
	mux.HandleFunc("GET /api/board", getBoard(d.Cases))
	mux.HandleFunc("GET /api/metrics", getMetrics(d.Metrics))
	mux.HandleFunc("DELETE /api/state", deleteState(d.Reset))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, ApiError{"not_found", "No such endpoint."})
	})
	return recoverer(d.Log, logRequests(d.Log, cors(d.FrontendOrigins, mux)))
}

func health(db Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			writeError(w, r, fmt.Errorf("database ping: %w", err))
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

// cors answers browsers from allowed origins only, echoing the request origin back.
func cors(allowed []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Vary", "Origin")
		if origin := r.Header.Get("Origin"); originAllowed(allowed, origin) {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			// Last-Event-ID / Cache-Control: sent by SSE clients (fetch-event-source) on the investigate stream.
			h.Set("Access-Control-Allow-Headers", "Content-Type, Accept, Cache-Control, Last-Event-ID")
			h.Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func originAllowed(allowed []string, origin string) bool {
	if origin == "" {
		return false
	}
	for _, a := range allowed {
		if a == "*" || a == origin {
			return true
		}
	}
	return false
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) { s.status = code; s.ResponseWriter.WriteHeader(code) }

// Flush keeps SSE streaming working through the middleware.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func logRequests(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Info("http", "method", r.Method, "path", r.URL.Path, "status", rec.status, "dur", time.Since(start).Round(time.Millisecond))
	})
}

func recoverer(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Error("panic", "path", r.URL.Path, "panic", v)
				writeJSON(w, http.StatusInternalServerError, ApiError{"internal", "Something went wrong. Try again."})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
