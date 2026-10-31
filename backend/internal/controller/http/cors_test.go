package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORS(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	dev := []string{"http://localhost:3000", "http://127.0.0.1:3000"}
	tests := []struct {
		name       string
		allowed    []string
		method     string
		origin     string
		preflight  bool
		wantAllow  string
		wantStatus int
	}{
		{"allowed origin GET", dev, http.MethodGet, "http://localhost:3000", false, "http://localhost:3000", http.StatusTeapot},
		{"second allowed origin", dev, http.MethodGet, "http://127.0.0.1:3000", false, "http://127.0.0.1:3000", http.StatusTeapot},
		{"preflight allowed", dev, http.MethodOptions, "http://localhost:3000", true, "http://localhost:3000", http.StatusNoContent},
		{"foreign origin gets no header", dev, http.MethodGet, "http://evil.example", false, "", http.StatusTeapot},
		{"foreign preflight gets no header", dev, http.MethodOptions, "http://evil.example", true, "", http.StatusNoContent},
		{"no origin (curl)", dev, http.MethodGet, "", false, "", http.StatusTeapot},
		{"wildcard", []string{"*"}, http.MethodGet, "https://app.example", false, "https://app.example", http.StatusTeapot},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(tt.method, "/api/cases", nil)
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			if tt.preflight {
				r.Header.Set("Access-Control-Request-Method", "POST")
			}
			w := httptest.NewRecorder()
			cors(tt.allowed, ok).ServeHTTP(w, r)
			if got := w.Header().Get("Access-Control-Allow-Origin"); got != tt.wantAllow {
				t.Errorf("allow-origin = %q, want %q", got, tt.wantAllow)
			}
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
		})
	}
}
