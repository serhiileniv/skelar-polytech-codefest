package http

import (
	"context"
	"net/http"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// Asker answers a question about a stored verdict (docs/api.md → v2 · Ask).
type Asker interface {
	Ask(ctx context.Context, caseID, question string) (entity.Answer, error)
}

func postAsk(u Asker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Question string `json:"question"`
		}
		if err := decode(r, &req); err != nil {
			writeError(w, r, err)
			return
		}
		ans, err := u.Ask(r.Context(), r.PathValue("id"), req.Question)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, ans)
	}
}
