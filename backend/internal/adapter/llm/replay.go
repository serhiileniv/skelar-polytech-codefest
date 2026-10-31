package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

// Recording is a replay file: backend/replay/<caseId>.json. Only model turns are stored;
// tools re-run against the database and the validator re-checks the verdict on every replay.
type Recording struct {
	CaseID     string         `json:"caseId"`
	Model      string         `json:"model"`
	Source     string         `json:"source"` // "live" (recorded from the API) or "scripted" (hand-authored)
	RecordedAt time.Time      `json:"recordedAt"`
	Turns      []usecase.Turn `json:"turns"`
}

// Config selects live vs replay mode.
type Config struct {
	APIKey      string
	Model       string
	ReplayDir   string
	ForceReplay bool          // VERDICT_REPLAY=1
	Record      bool          // VERDICT_RECORD=1: save live runs as recordings
	ReplayDelay time.Duration // pause per replayed turn so the UI trace looks live
}

// Router implements usecase.AgentModel: replay when forced or when there is no key, otherwise live.
type Router struct {
	cfg  Config
	live *liveModel
}

func NewRouter(cfg Config) *Router {
	r := &Router{cfg: cfg}
	if cfg.APIKey != "" {
		r.live = newLiveModel(cfg.APIKey, cfg.Model)
	}
	return r
}

// Replaying reports whether runs use recordings rather than the API.
func (r *Router) Replaying() bool { return r.cfg.ForceReplay || r.live == nil }

func (r *Router) Start(_ context.Context, caseID, system, prompt string, tools []usecase.ToolSpec) (usecase.AgentSession, usecase.ModelInfo, error) {
	if !entity.IDPattern.MatchString(caseID) {
		return nil, usecase.ModelInfo{}, entity.Fail(entity.ErrBadRequest, "Invalid case id.")
	}
	if r.Replaying() {
		rec, err := LoadRecording(r.cfg.ReplayDir, caseID)
		if errors.Is(err, fs.ErrNotExist) {
			return nil, usecase.ModelInfo{}, entity.Fail(entity.ErrLLMUnavailable, "No API key and no replay recording for %s.", caseID)
		}
		if err != nil {
			return nil, usecase.ModelInfo{}, err
		}
		return &replaySession{rec: rec, delay: r.cfg.ReplayDelay}, usecase.ModelInfo{Model: rec.Model, Replay: true}, nil
	}
	var s usecase.AgentSession = r.live.start(system, prompt, tools)
	if r.cfg.Record {
		s = &recordingSession{inner: s, dir: r.cfg.ReplayDir, rec: Recording{CaseID: caseID, Model: r.cfg.Model, Source: "live"}}
	}
	return s, usecase.ModelInfo{Model: r.cfg.Model, Replay: false}, nil
}

func recordingPath(dir, caseID string) string { return filepath.Join(dir, caseID+".json") }

func LoadRecording(dir, caseID string) (Recording, error) {
	var rec Recording
	b, err := os.ReadFile(recordingPath(dir, caseID))
	if err != nil {
		return rec, err
	}
	if err := json.Unmarshal(b, &rec); err != nil {
		return rec, fmt.Errorf("replay %s: %w", caseID, err)
	}
	return rec, nil
}

// replaySession plays recorded turns in order, ignoring tool results (the tools still ran for real).
type replaySession struct {
	rec   Recording
	next  int
	delay time.Duration
}

func (s *replaySession) Next(ctx context.Context, _ []usecase.ToolResult, _ bool) (usecase.Turn, error) {
	if s.delay > 0 {
		select {
		case <-ctx.Done():
			return usecase.Turn{}, ctx.Err()
		case <-time.After(s.delay):
		}
	}
	if s.next >= len(s.rec.Turns) {
		return usecase.Turn{Text: "Recording ended."}, nil // the loop then falls back to a no-verdict result
	}
	t := s.rec.Turns[s.next]
	s.next++
	return t, nil
}

func (s *replaySession) Close(bool) {}

// recordingSession wraps a live session and saves its turns when a verdict was stored.
type recordingSession struct {
	inner usecase.AgentSession
	dir   string
	rec   Recording
}

func (s *recordingSession) Next(ctx context.Context, results []usecase.ToolResult, final bool) (usecase.Turn, error) {
	t, err := s.inner.Next(ctx, results, final)
	if err == nil {
		s.rec.Turns = append(s.rec.Turns, t)
	}
	return t, err
}

func (s *recordingSession) Close(succeeded bool) {
	s.inner.Close(succeeded)
	if !succeeded {
		return
	}
	s.rec.RecordedAt = time.Now().UTC()
	b, err := json.MarshalIndent(s.rec, "", " ")
	if err == nil {
		_ = os.MkdirAll(s.dir, 0o755)
		_ = os.WriteFile(recordingPath(s.dir, s.rec.CaseID), append(b, '\n'), 0o644)
	}
}
